import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

type AnyStyle = ViewStyle & TextStyle;

/**
 * The flattened style of a rendered element, for assertions on layout: it resolves a Pressable's
 * style function (in its resting state) and arrays, so a test reads one plain object.
 */
export function styleOf(element: { props: Record<string, unknown> }): AnyStyle {
  const raw = element.props.style;
  const resolved =
    typeof raw === 'function'
      ? (raw as (state: { pressed: boolean }) => StyleProp<AnyStyle>)({ pressed: false })
      : (raw as StyleProp<AnyStyle>);
  return StyleSheet.flatten(resolved) ?? {};
}
