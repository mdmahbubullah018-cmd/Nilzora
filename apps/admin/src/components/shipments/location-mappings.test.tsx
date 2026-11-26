// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { courierConfig, MAPPING_ID } from './fixtures';
import {
  ALL_DISTRICTS,
  filterMappings,
  LocationMappingsView,
  parseMappingFilters,
} from './location-mappings';

const actions = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/courier-actions', () => ({
  saveLocationMappingAction: actions.save,
  deleteLocationMappingAction: actions.remove,
}));
vi.mock('next/form', () => ({
  default: ({ action, ...props }: ComponentProps<'form'> & { action: string }) => (
    <form action={action} method="get" {...props} />
  ),
}));

if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

const csrf = { name: 'csrf_token', token: 'signed-test-token' };
const { locationMappings } = courierConfig();
const mappings = [
  ...locationMappings,
  {
    id: '9c1c8f0e-6f0f-4f0f-8f0f-2f0f0f0f0f06',
    provider: 'steadfast',
    district: 'Chattogram',
    area: '',
    destination: { cityId: 7 },
    label: null,
    updatedAt: '2026-11-14T10:00:00.000Z',
  },
];

beforeEach(() => {
  actions.save.mockReset().mockResolvedValue({ status: 'idle' });
  actions.remove.mockReset().mockResolvedValue({ status: 'idle' });
});
afterEach(cleanup);

describe('mapping filters', () => {
  it('reads only known couriers and districts from the address', () => {
    expect(parseMappingFilters({ courier: 'pathao', district: 'Dhaka', q: ' mir ' })).toEqual({
      provider: 'pathao',
      district: 'Dhaka',
      q: 'mir',
    });
    expect(parseMappingFilters({ courier: 'other', district: 'Atlantis' })).toEqual({
      provider: undefined,
      district: undefined,
      q: undefined,
    });
    expect(ALL_DISTRICTS).toContain('Chattogram');
  });

  it('filters by courier, district and search', () => {
    expect(filterMappings(mappings, { provider: 'steadfast' }).map((m) => m.district)).toEqual([
      'Chattogram',
    ]);
    expect(filterMappings(mappings, { q: 'mirpur' })).toHaveLength(1);
    expect(filterMappings(mappings, { q: '52' })).toHaveLength(1);
    expect(filterMappings(mappings, { district: 'Sylhet' })).toHaveLength(0);
  });
});

describe('LocationMappingsView', () => {
  it('lists mappings read-only for an account that cannot edit', () => {
    render(<LocationMappingsView mappings={mappings} filters={{}} canEdit={false} csrf={csrf} />);
    const table = screen.getByRole('table', { name: 'Courier location mappings' });
    expect(within(table).getByText('Whole district')).toBeTruthy();
    expect(within(table).getByText('City id: 1 · Zone id: 52')).toBeTruthy();
    expect(screen.queryByText('Add a location mapping')).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove the/ })).toBeNull();
  });

  it('adds a mapping with courier, district, area, fields and label', async () => {
    render(<LocationMappingsView mappings={mappings} filters={{}} canEdit csrf={csrf} />);
    const form = screen.getByRole('form', { name: 'Add a location mapping' });
    fireEvent.change(within(form).getByLabelText(/^District/), { target: { value: 'Gazipur' } });
    fireEvent.change(within(form).getByLabelText(/^Area/), { target: { value: 'Tongi' } });
    fireEvent.change(within(form).getByLabelText('Field'), { target: { value: 'cityId' } });
    fireEvent.change(within(form).getByLabelText('Value'), { target: { value: '12' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add a field' }));
    expect(within(form).getAllByLabelText('Field')).toHaveLength(2);
    fireEvent.click(within(form).getByRole('button', { name: 'Add mapping' }));
    await waitFor(() => expect(actions.save).toHaveBeenCalled());
    const sent = actions.save.mock.calls[0]?.[1] as FormData;
    expect(sent.get('district')).toBe('Gazipur');
    expect(sent.get('area')).toBe('Tongi');
    expect(sent.getAll('destKey')).toEqual(['cityId', '']);
    expect(sent.getAll('destValue')).toEqual(['12', '']);
  });

  it('edits a mapping without changing what identifies it', () => {
    render(<LocationMappingsView mappings={mappings} filters={{}} canEdit csrf={csrf} />);
    const forms = screen.getAllByRole('form', { name: 'Edit location mapping' });
    const pathao = forms[0];
    if (!pathao) throw new Error('edit form missing');
    expect(within(pathao).queryByLabelText(/^District/)).toBeNull();
    expect(pathao.querySelector<HTMLInputElement>('input[name="district"]')?.value).toBe('Dhaka');
    expect(
      within(pathao)
        .getAllByLabelText('Field')
        .map((input) => (input as HTMLInputElement).value),
    ).toEqual(['cityId', 'zoneId']);
  });

  it('confirms before removing a mapping', async () => {
    render(<LocationMappingsView mappings={mappings} filters={{}} canEdit csrf={csrf} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove the Pathao mapping for Mirpur, Dhaka' }),
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove mapping' }));
    await waitFor(() => expect(actions.remove).toHaveBeenCalled());
    expect((actions.remove.mock.calls[0]?.[1] as FormData).get('mappingId')).toBe(MAPPING_ID);
  });

  it('explains an empty filtered list', () => {
    render(
      <LocationMappingsView
        mappings={mappings}
        filters={{ district: 'Sylhet' }}
        canEdit={false}
        csrf={csrf}
      />,
    );
    expect(screen.getByText('No mappings match these filters')).toBeTruthy();
  });
});
