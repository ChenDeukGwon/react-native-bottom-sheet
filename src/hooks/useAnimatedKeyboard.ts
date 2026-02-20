import { useCallback, useEffect, useRef } from 'react';
import {
  Keyboard,
  type KeyboardEvent,
  type KeyboardEventEasing,
  type KeyboardEventName,
  Platform,
} from 'react-native';
import {
  runOnUI,
  useAnimatedReaction,
  useSharedValue,
} from 'react-native-reanimated';
import { KEYBOARD_STATUS, SCREEN_HEIGHT } from '../constants';
import type { KeyboardState } from '../types';

/**
 * Try to use react-native-keyboard-controller's KeyboardEvents if available.
 * It uses WindowInsetsAnimation API on Android, which works reliably
 * in Edge-to-Edge + adjustNothing mode where the standard Keyboard API may not.
 */
let KeyboardControllerEvents: {
  addListener: (name: string, cb: (e: any) => any) => { remove: () => void };
} | null = null;

try {
  const rnkc = require('react-native-keyboard-controller');
  if (rnkc?.KeyboardEvents?.addListener) {
    KeyboardControllerEvents = rnkc.KeyboardEvents;
  }
} catch {}

const useKeyboardControllerEvents = Platform.OS === 'android' && !!KeyboardControllerEvents;

const KEYBOARD_EVENT_MAPPER = {
  KEYBOARD_SHOW: Platform.select({
    ios: 'keyboardWillShow',
    // react-native-keyboard-controller supports keyboardWillShow on Android too
    android: useKeyboardControllerEvents ? 'keyboardWillShow' : 'keyboardDidShow',
    default: '',
  }) as KeyboardEventName,
  KEYBOARD_HIDE: Platform.select({
    ios: 'keyboardWillHide',
    android: useKeyboardControllerEvents ? 'keyboardWillHide' : 'keyboardDidHide',
    default: '',
  }) as KeyboardEventName,
};

const INITIAL_STATE: KeyboardState = {
  status: KEYBOARD_STATUS.UNDETERMINED,
  height: 0,
  heightWithinContainer: 0,
  easing: 'keyboard',
  duration: 500,
};

export const useAnimatedKeyboard = () => {
  //#region variables
  const textInputNodesRef = useRef(new Set<number>());
  const state = useSharedValue(INITIAL_STATE);
  const temporaryCachedState = useSharedValue<Omit<
    KeyboardState,
    'heightWithinContainer' | 'target'
  > | null>(null);
  //#endregion

  //#region worklets
  const handleKeyboardEvent = useCallback(
    (
      status: KEYBOARD_STATUS,
      height: number,
      duration: number,
      easing: KeyboardEventEasing,
      bottomOffset?: number
    ) => {
      'worklet';
      const currentState = state.get();

      /**
       * if the keyboard event was fired before the `onFocus` on TextInput,
       * then we cache the event, and wait till the `target` is been set
       * to be updated then fire this function again.
       */
      if (status === KEYBOARD_STATUS.SHOWN && !currentState.target) {
        temporaryCachedState.set({
          status,
          height,
          duration,
          easing,
        });
        return;
      }

      /**
       * clear temporary cached state.
       */
      temporaryCachedState.set(null);

      /**
       * if keyboard status is hidden, then we keep old height.
       */
      let adjustedHeight =
        status === KEYBOARD_STATUS.SHOWN ? height : currentState.height;

      /**
       * if keyboard had an bottom offset -android bottom bar-, then
       * we add that offset to the keyboard height.
       */
      if (bottomOffset) {
        adjustedHeight = adjustedHeight + bottomOffset;
      }

      state.set(state => ({
        status,
        easing,
        duration,
        height: adjustedHeight,
        target: state.target,
        heightWithinContainer: state.heightWithinContainer,
      }));
    },
    [state, temporaryCachedState]
  );
  //#endregion

  //#region effects
  useEffect(() => {
    /**
     * When react-native-keyboard-controller is available (Android),
     * use its KeyboardEvents which rely on WindowInsetsAnimation API.
     * This works reliably in Edge-to-Edge + adjustNothing mode.
     */
    if (useKeyboardControllerEvents && KeyboardControllerEvents) {
      const handleOnKeyboardShow = (event: any) => {
        runOnUI(handleKeyboardEvent)(
          KEYBOARD_STATUS.SHOWN,
          event.height,
          event.duration ?? 250,
          'keyboard' as KeyboardEventEasing,
          0
        );
      };
      const handleOnKeyboardHide = (event: any) => {
        runOnUI(handleKeyboardEvent)(
          KEYBOARD_STATUS.HIDDEN,
          event.height,
          event.duration ?? 250,
          'keyboard' as KeyboardEventEasing
        );
      };

      const showSubscription = KeyboardControllerEvents.addListener(
        KEYBOARD_EVENT_MAPPER.KEYBOARD_SHOW,
        handleOnKeyboardShow
      );
      const hideSubscription = KeyboardControllerEvents.addListener(
        KEYBOARD_EVENT_MAPPER.KEYBOARD_HIDE,
        handleOnKeyboardHide
      );

      return () => {
        showSubscription.remove();
        hideSubscription.remove();
      };
    }

    /**
     * Fallback: standard Keyboard API (iOS, or Android without keyboard-controller)
     */
    const handleOnKeyboardShow = (event: KeyboardEvent) => {
      runOnUI(handleKeyboardEvent)(
        KEYBOARD_STATUS.SHOWN,
        event.endCoordinates.height,
        event.duration,
        event.easing,
        SCREEN_HEIGHT -
          event.endCoordinates.height -
          event.endCoordinates.screenY
      );
    };
    const handleOnKeyboardHide = (event: KeyboardEvent) => {
      runOnUI(handleKeyboardEvent)(
        KEYBOARD_STATUS.HIDDEN,
        event.endCoordinates.height,
        event.duration,
        event.easing
      );
    };

    const showSubscription = Keyboard.addListener(
      KEYBOARD_EVENT_MAPPER.KEYBOARD_SHOW,
      handleOnKeyboardShow
    );

    const hideSubscription = Keyboard.addListener(
      KEYBOARD_EVENT_MAPPER.KEYBOARD_HIDE,
      handleOnKeyboardHide
    );

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [handleKeyboardEvent]);

  /**
   * This reaction is needed to handle the issue with multiline text input.
   *
   * @link https://github.com/gorhom/react-native-bottom-sheet/issues/411
   */
  useAnimatedReaction(
    () => state.value.target,
    (result, previous) => {
      if (!result || result === previous) {
        return;
      }

      const cachedState = temporaryCachedState.get();
      if (!cachedState) {
        return;
      }

      handleKeyboardEvent(
        cachedState.status,
        cachedState.height,
        cachedState.duration,
        cachedState.easing
      );
    },
    [temporaryCachedState, handleKeyboardEvent]
  );
  //#endregion

  return { state, textInputNodesRef };
};
