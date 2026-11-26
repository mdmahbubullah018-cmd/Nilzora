import type { Href } from 'expo-router';

/**
 * The address book's route. The generated typed routes (.expo/types) list the file
 * app/addresses/index.tsx as "/addresses/index", while the screen's URL is "/addresses"
 * (the path the return-to allow-list and deep links use), so the string is typed once here.
 */
export const ADDRESSES_HREF = '/addresses' as Href;
