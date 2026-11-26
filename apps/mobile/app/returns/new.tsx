import { useLocalSearchParams } from 'expo-router';
import { RequestReturnScreen } from '@/features/returns/request-return';

export default function NewReturnRoute() {
  const { order } = useLocalSearchParams<{ order: string }>();
  return <RequestReturnScreen orderNumber={typeof order === 'string' ? order : ''} />;
}
