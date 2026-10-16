import Svg, { Path } from 'react-native-svg';
import { AppText as Text } from './AppText';
import { tableReactions, type ReactionId } from '../multiplayer/tableReactions';

/** Shared artwork keeps the picker, travelling reaction and catch consistent. */
export function TableReactionIcon({ reaction, size = 30 }: { reaction: ReactionId; size?: number }) {
  if (reaction !== 'jinx') return <Text style={{ fontSize: size }}>{tableReactions[reaction].emoji}</Text>;
  return <Svg testID="jinx-elbow-icon" accessible={false} width={size} height={size} viewBox="0 0 64 64">
    {/* A tucked fist and forearm meet the upper arm at the projecting elbow. */}
    <Path d="M12 45 31 30 16 20 12 12 17 7 25 9 29 16 49 28Q57 33 49 40L24 57Z"
      fill="#ECAF73" stroke="#75452F" strokeWidth={2.5} strokeLinejoin="round" />
    <Path d="m12 45 12 12 8-7-12-12Z" fill="#BF344A" stroke="#75452F" strokeWidth={2.5} strokeLinejoin="round" />
    <Path d="m18 12 5 3m-7 1 6 3M31 30l9 5" fill="none" stroke="#A46743" strokeWidth={2} strokeLinecap="round" />
    {/* Impact ticks emphasize an elbow jab rather than a flexed muscle. */}
    <Path d="m57 25 4-3m-2 12h4m-6 8 4 3" fill="none" stroke="#E9BB49" strokeWidth={3} strokeLinecap="round" />
    <Path d="m4 29 13 3M3 36h11" fill="none" stroke="#E9BB49" strokeWidth={2.5} strokeLinecap="round" />
  </Svg>;
}
