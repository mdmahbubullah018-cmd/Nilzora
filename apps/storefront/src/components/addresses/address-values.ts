/*
 * Address form value shape and its empty starting value. A plain module on purpose: the
 * server page passes EMPTY_ADDRESS to the client form, and a constant exported from a
 * 'use client' file is only a client reference on the server.
 */

export interface AddressFormValues {
  label: string;
  recipientName: string;
  phone: string;
  division: string;
  district: string;
  area: string;
  addressLine: string;
  postalCode: string;
  landmark: string;
}

export const EMPTY_ADDRESS: AddressFormValues = {
  label: '',
  recipientName: '',
  phone: '',
  division: '',
  district: '',
  area: '',
  addressLine: '',
  postalCode: '',
  landmark: '',
};
