import { MAX_ADDRESSES, type Address } from '@nilzora/contracts';
import { useRouter } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/button';
import { Notice } from '@/components/notice';
import { QueryState } from '@/components/query-state';
import { Screen, STACK_EDGES } from '@/components/screen';
import { describeApiError } from '@/lib/errors';
import { useManualRefresh } from '@/query';
import { theme } from '@/theme';
import { AddressCard } from './address-card';
import { addressSummary } from './address-format';
import { ConfirmDialog } from './confirm-dialog';
import { useAddresses, useDeleteAddress, useMakeDefaultAddress } from './use-addresses';

type Feedback = { tone: 'success' | 'danger'; title?: string; text: string };

/**
 * The address book: every saved address with edit, delete (after a confirmation) and
 * "Set as default", and a way to add another until the limit is reached. Render it inside
 * <SignedInGate>.
 */
export function AddressesScreen() {
  const router = useRouter();
  const query = useAddresses();
  const { onRefresh } = useManualRefresh(query.refetch);
  const makeDefault = useMakeDefaultAddress();
  const remove = useDeleteAddress();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [toDelete, setToDelete] = useState<Address | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const working = useRef(false);

  function report(next: Feedback) {
    setFeedback(next);
    void AccessibilityInfo.announceForAccessibility(next.text);
  }

  function reportFailure(error: unknown) {
    const { title, message } = describeApiError(error);
    setFeedback({ tone: 'danger', title, text: message });
  }

  async function setDefault(address: Address) {
    if (working.current) return;
    working.current = true;
    setWorkingId(address.id);
    setFeedback(null);
    try {
      await makeDefault.mutateAsync(address.id);
      report({ tone: 'success', text: 'Your default address has been updated.' });
    } catch (error) {
      reportFailure(error);
    } finally {
      working.current = false;
      setWorkingId(null);
    }
  }

  async function confirmDelete() {
    if (toDelete === null || working.current) return;
    working.current = true;
    setWorkingId(toDelete.id);
    setFeedback(null);
    try {
      await remove.mutateAsync(toDelete.id);
      report({ tone: 'success', text: 'The address has been deleted.' });
    } catch (error) {
      reportFailure(error);
    } finally {
      working.current = false;
      setWorkingId(null);
      setToDelete(null);
    }
  }

  const addAddress = () => {
    router.push('/addresses/new');
  };

  return (
    <Screen edges={STACK_EDGES} onRefresh={onRefresh}>
      <Text style={styles.intro}>
        Where we deliver your orders. Your default address is selected first at checkout.
      </Text>
      {feedback ? (
        <Notice tone={feedback.tone} title={feedback.title}>
          {feedback.text}
        </Notice>
      ) : null}
      <QueryState
        query={query}
        loadingLabel="Loading your addresses"
        isEmpty={(addresses) => addresses.length === 0}
        empty={{
          icon: MapPin,
          title: 'No saved addresses yet',
          description: 'Add a delivery address and it will be ready at checkout.',
          action: <Button label="Add address" onPress={addAddress} />,
        }}
      >
        {(addresses) => (
          <View style={styles.list}>
            {addresses.length >= MAX_ADDRESSES ? (
              <Notice tone="info">
                {`You can keep up to ${MAX_ADDRESSES} addresses. Delete one to add another.`}
              </Notice>
            ) : (
              <Button label="Add address" onPress={addAddress} />
            )}
            {addresses.map((address) => (
              <AddressCard
                key={address.id}
                address={address}
                busy={workingId !== null}
                makingDefault={makeDefault.isPending && workingId === address.id}
                onEdit={() => {
                  router.push({
                    pathname: '/addresses/[addressId]',
                    params: { addressId: address.id },
                  });
                }}
                onMakeDefault={() => void setDefault(address)}
                onDelete={() => {
                  setToDelete(address);
                }}
              />
            ))}
          </View>
        )}
      </QueryState>

      <ConfirmDialog
        visible={toDelete !== null}
        title="Delete this address?"
        confirmLabel="Delete address"
        destructive
        busy={remove.isPending}
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          setToDelete(null);
        }}
      >
        {toDelete ? <Text style={styles.dialogName}>{addressSummary(toDelete)}</Text> : null}
        <Text style={styles.dialogText}>
          The address is removed from your address book. Orders you have already placed keep their
          delivery details.
          {toDelete?.isDefault && (query.data?.length ?? 0) > 1
            ? ' One of your other addresses becomes the default.'
            : ''}
        </Text>
      </ConfirmDialog>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { color: theme.colors.mutedForeground, fontSize: 14, lineHeight: 20 },
  list: { gap: theme.spacing[4] },
  dialogName: {
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: theme.fontWeights.semibold,
  },
  dialogText: { color: theme.colors.body, fontSize: 14, lineHeight: 20 },
});
