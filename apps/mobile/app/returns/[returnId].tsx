import { useLocalSearchParams } from 'expo-router';
import { ReturnDetailScreen } from '@/features/returns/return-detail';

export default function ReturnRoute() {
  const { returnId } = useLocalSearchParams<{ returnId: string }>();
  return <ReturnDetailScreen returnId={typeof returnId === 'string' ? returnId : ''} />;
}
