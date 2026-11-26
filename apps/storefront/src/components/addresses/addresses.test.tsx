import { fireEvent, render, screen, within } from '@testing-library/react';
import { BD_DISTRICTS, BD_DIVISIONS } from '@nilzora/contracts';
import type { FormState } from '@nilzora/web-session';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { address, HOME_ID, OFFICE_ID, officeAddress } from '@/testing/commerce-fixtures';
import type { CsrfField, FormAction } from '../auth/form-kit';
import { DeleteAddressFormView, MakeDefaultFormView } from './address-actions-forms';
import { AddressBlock, addressLines, addressSummary } from './address-block';
import { AddressCard } from './address-card';
import { AddressForm, AddressFormView, type AddressFormViewProps } from './address-form';
import { EMPTY_ADDRESS } from './address-values';

const csrf: CsrfField = { name: 'csrf_token', token: 'signed-csrf-value' };
const idle: FormState = { status: 'idle' };
const noop = () => undefined;

const baseProps: AddressFormViewProps = {
  csrf,
  next: '/account/addresses',
  initial: EMPTY_ADDRESS,
  defaultChoice: 'offer',
  submitLabel: 'Save address',
  cancelHref: '/account/addresses',
  state: idle,
  formAction: noop,
  pending: false,
};

function field<T extends HTMLElement>(label: RegExp, type: new () => T): T {
  const element = screen.getByLabelText(label);
  if (!(element instanceof type)) throw new Error(`${String(label)} has an unexpected type`);
  return element;
}

const select = (label: RegExp) => field(label, HTMLSelectElement);
const input = (label: RegExp) => field(label, HTMLInputElement);

function hiddenValue(container: HTMLElement, name: string): string | undefined {
  const element = container.querySelector(`input[type="hidden"][name="${name}"]`);
  return element instanceof HTMLInputElement ? element.value : undefined;
}

describe('AddressFormView', () => {
  it('asks for each part of a Bangladeshi address with the right hints', () => {
    const { container } = render(<AddressFormView {...baseProps} />);

    const names = Array.from(container.querySelectorAll('input, select'), (element) =>
      element.getAttribute('name'),
    );
    expect(names.sort()).toEqual(
      [
        'addressLine',
        'area',
        'csrf_token',
        'district',
        'division',
        'isDefault',
        'label',
        'landmark',
        'next',
        'phone',
        'postalCode',
        'recipientName',
      ].sort(),
    );
    expect(hiddenValue(container, 'csrf_token')).toBe('signed-csrf-value');
    expect(hiddenValue(container, 'next')).toBe('/account/addresses');
    expect(hiddenValue(container, 'addressId')).toBeUndefined();

    expect(input(/^Recipient name/).autocomplete).toBe('name');
    expect(input(/^Recipient name/).required).toBe(true);
    expect(input(/^Mobile phone/).type).toBe('tel');
    expect(select(/^Division/).getAttribute('autocomplete')).toBe('address-level1');
    expect(select(/^District/).getAttribute('autocomplete')).toBe('address-level2');
    expect(input(/^Area, thana or upazila/).required).toBe(true);
    expect(input(/^House, road and block/).autocomplete).toBe('address-line1');
    expect(input(/^Postal code/).inputMode).toBe('numeric');
    expect(input(/^Postal code/).required).toBe(false);
    expect(input(/^Label/).maxLength).toBe(40);
    expect(screen.getByRole('link', { name: 'Cancel' }).getAttribute('href')).toBe(
      '/account/addresses',
    );
  });

  it('lists every district, grouped by division, in the HTML served without JavaScript', () => {
    const html = renderToString(<AddressFormView {...baseProps} />);
    const page = document.createElement('div');
    page.innerHTML = html;

    const district = page.querySelector('select[name="district"]');
    const groups = Array.from(district?.querySelectorAll('optgroup') ?? [], (group) =>
      group.getAttribute('label'),
    );
    expect(groups).toEqual(BD_DIVISIONS.map((division) => `${division} Division`));
    const all = Object.values(BD_DISTRICTS).flat();
    expect(district?.querySelectorAll('optgroup option')).toHaveLength(all.length);
    expect(district?.hasAttribute('disabled')).toBe(false);
  });

  it('lists only the districts of the chosen division once interactive', () => {
    render(<AddressFormView {...baseProps} />);

    const district = select(/^District/);
    expect(district.disabled).toBe(true);
    expect(district.options[0]?.textContent).toBe('Choose a division first');

    fireEvent.change(select(/^Division/), { target: { value: 'Sylhet' } });
    // The district list starts afresh for each division, so look it up again.
    const sylhet = select(/^District/);
    expect(sylhet.disabled).toBe(false);
    expect(Array.from(sylhet.options, (option) => option.value)).toEqual([
      '',
      ...BD_DISTRICTS.Sylhet,
    ]);
    expect(sylhet.querySelector('optgroup')).toBeNull();

    fireEvent.change(sylhet, { target: { value: 'Sunamganj' } });
    expect(sylhet.value).toBe('Sunamganj');
    // A district of another division is cleared when the division changes.
    fireEvent.change(select(/^Division/), { target: { value: 'Khulna' } });
    expect(select(/^District/).value).toBe('');
  });

  it('keeps what was typed and marks each invalid field after an error', () => {
    render(
      <AddressFormView
        {...baseProps}
        state={{
          status: 'error',
          message: 'Check the highlighted fields.',
          fieldErrors: {
            phone: 'Enter a valid Bangladeshi mobile number, e.g. 01712-345678.',
            district: 'Choose a district in the selected division',
          },
          values: {
            ...EMPTY_ADDRESS,
            recipientName: 'Rahima',
            phone: '0123',
            division: 'Khulna',
            district: 'Jashore',
            isDefault: 'true',
          },
        }}
      />,
    );

    expect(screen.getByRole('alert').textContent).toBe('Check the highlighted fields.');
    expect(input(/^Recipient name/).value).toBe('Rahima');
    expect(input(/^Mobile phone/).value).toBe('0123');
    expect(input(/^Mobile phone/).getAttribute('aria-invalid')).toBe('true');
    expect(select(/^Division/).value).toBe('Khulna');
    expect(select(/^District/).value).toBe('Jashore');
    expect(select(/^District/).getAttribute('aria-describedby')).toBe('address-district-error');
    expect(field(/^Use as my default delivery address/, HTMLInputElement).checked).toBe(true);
  });

  it('carries the address id when editing and explains the default choice', () => {
    const { container, rerender } = render(
      <AddressFormView
        {...baseProps}
        addressId={HOME_ID}
        defaultChoice="current"
        initial={{ ...EMPTY_ADDRESS, division: 'Dhaka', district: 'Gazipur' }}
      />,
    );
    expect(hiddenValue(container, 'addressId')).toBe(HOME_ID);
    expect(select(/^District/).value).toBe('Gazipur');
    expect(screen.getByText('This is your default delivery address.')).not.toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();

    rerender(<AddressFormView {...baseProps} defaultChoice="first" />);
    expect(
      screen.getByText('Your first address becomes your default delivery address.'),
    ).not.toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();

    rerender(<AddressFormView {...baseProps} />);
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', false);
  });
});

describe('AddressForm', () => {
  it('posts the chosen division and district with the CSRF token', async () => {
    const action = vi.fn<FormAction>(() =>
      Promise.resolve({ status: 'error', message: 'Nilzora could not be reached.' }),
    );
    render(<AddressForm action={action} {...baseProps} next="/checkout" />);

    fireEvent.change(input(/^Recipient name/), { target: { value: 'Rahima Khatun' } });
    fireEvent.change(input(/^Mobile phone/), { target: { value: '01712345678' } });
    fireEvent.change(select(/^Division/), { target: { value: 'Rajshahi' } });
    fireEvent.change(select(/^District/), { target: { value: 'Bogura' } });
    fireEvent.change(input(/^Area/), { target: { value: 'Sherpur' } });
    fireEvent.change(input(/^House, road and block/), { target: { value: 'House 3, Road 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Nilzora could not be reached.');
    const submitted = action.mock.calls[0]?.[1];
    expect(submitted?.get('csrf_token')).toBe('signed-csrf-value');
    expect(submitted?.get('next')).toBe('/checkout');
    expect(submitted?.get('division')).toBe('Rajshahi');
    expect(submitted?.get('district')).toBe('Bogura');
    expect(submitted?.get('isDefault')).toBeNull();
  });

  it('keeps the division and district through an error, so the next submit sends them', async () => {
    let attempt = 0;
    const action = vi.fn<FormAction>((_previous, formData) => {
      attempt += 1;
      const values = Object.fromEntries(
        ['recipientName', 'phone', 'division', 'district', 'area', 'addressLine'].map((name) => [
          name,
          ((value) => (typeof value === 'string' ? value : ''))(formData.get(name)),
        ]),
      );
      return Promise.resolve(
        attempt === 1
          ? {
              status: 'error',
              message: 'Check the highlighted fields.',
              fieldErrors: { phone: 'Enter a valid Bangladeshi mobile number.' },
              values,
            }
          : { status: 'success', message: 'Saved.', values },
      );
    });
    render(<AddressForm action={action} {...baseProps} />);

    fireEvent.change(input(/^Recipient name/), { target: { value: 'Rahima Khatun' } });
    fireEvent.change(input(/^Mobile phone/), { target: { value: '123' } });
    fireEvent.change(select(/^Division/), { target: { value: 'Rajshahi' } });
    fireEvent.change(select(/^District/), { target: { value: 'Bogura' } });
    fireEvent.change(input(/^Area/), { target: { value: 'Sherpur' } });
    fireEvent.change(input(/^House, road and block/), { target: { value: 'House 3, Road 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
    await screen.findByRole('alert');

    // After React resets the form, the echoed choices are still selected.
    expect(select(/^Division/).value).toBe('Rajshahi');
    expect(select(/^District/).value).toBe('Bogura');

    fireEvent.change(input(/^Mobile phone/), { target: { value: '01712345678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));
    await screen.findByText('Saved.');
    const second = action.mock.calls[1]?.[1];
    expect(second?.get('division')).toBe('Rajshahi');
    expect(second?.get('district')).toBe('Bogura');
  });
});

describe('address action forms', () => {
  it('makes an address the default with a CSRF-protected post', () => {
    const { container } = render(
      <MakeDefaultFormView
        csrf={csrf}
        addressId={OFFICE_ID}
        addressName="Office · Agrabad, Chattogram"
        state={{ status: 'error', message: 'This address no longer exists.' }}
        formAction={noop}
        pending={false}
      />,
    );

    expect(hiddenValue(container, 'addressId')).toBe(OFFICE_ID);
    expect(hiddenValue(container, 'csrf_token')).toBe('signed-csrf-value');
    expect(
      screen.getByRole('button', { name: 'Make default: Office · Agrabad, Chattogram' }),
    ).toHaveProperty('type', 'submit');
    expect(screen.getByRole('alert').textContent).toBe('This address no longer exists.');
  });

  it('deletes only from the confirmation form, with a way to keep the address', () => {
    const { container } = render(
      <DeleteAddressFormView
        csrf={csrf}
        addressId={HOME_ID}
        addressName="Home · Dhanmondi, Dhaka"
        cancelHref="/account/addresses"
        state={idle}
        formAction={noop}
        pending
      />,
    );

    expect(hiddenValue(container, 'addressId')).toBe(HOME_ID);
    expect(hiddenValue(container, 'csrf_token')).toBe('signed-csrf-value');
    expect(
      screen.getByRole('button', { name: 'Delete address: Home · Dhanmondi, Dhaka' }),
    ).toHaveProperty('disabled', true);
    expect(screen.getByRole('link', { name: 'Keep address' }).getAttribute('href')).toBe(
      '/account/addresses',
    );
  });
});

describe('AddressCard', () => {
  const action: FormAction = () => Promise.resolve(idle);

  it('marks the default address and offers edit and delete', () => {
    render(<AddressCard address={address()} csrf={csrf} makeDefaultAction={action} />);

    expect(screen.getByRole('heading', { name: 'Home' })).not.toBeNull();
    expect(screen.getByText('Default')).not.toBeNull();
    expect(
      screen.getByRole('link', { name: 'Edit: Home · Dhanmondi, Dhaka' }).getAttribute('href'),
    ).toBe(`/account/addresses/${HOME_ID}/edit`);
    expect(
      screen.getByRole('link', { name: 'Delete: Home · Dhanmondi, Dhaka' }).getAttribute('href'),
    ).toBe(`/account/addresses/${HOME_ID}/delete`);
    expect(screen.queryByRole('button', { name: /Make default/ })).toBeNull();
    expect(screen.getByText('Delivery zone: Inside Dhaka')).not.toBeNull();
  });

  it('offers to make another address the default', () => {
    render(
      <AddressCard
        address={officeAddress({ label: null })}
        csrf={csrf}
        makeDefaultAction={action}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Rahima Khatun' })).not.toBeNull();
    expect(screen.queryByText('Default')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Make default: Agrabad, Chattogram' }),
    ).not.toBeNull();
  });
});

describe('AddressBlock', () => {
  it('writes the address as on a parcel', () => {
    const home = address({ landmark: 'Opposite the lake' });
    expect(addressLines(home)).toEqual([
      'House 12, Road 5',
      'Near Opposite the lake',
      'Dhanmondi, Dhaka 1205',
      'Dhaka Division',
    ]);
    expect(addressLines(officeAddress())).toEqual([
      'Level 4, Agrabad Tower',
      'Agrabad, Chattogram',
      'Chattogram Division',
    ]);
    expect(addressSummary(home)).toBe('Home · Dhanmondi, Dhaka');

    const { container } = render(<AddressBlock address={home} />);
    expect(within(container).getByText('01712-345678').textContent).toBe('Phone: 01712-345678');
  });
});
