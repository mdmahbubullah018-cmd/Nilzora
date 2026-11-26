import type { Route } from 'next';

/** The admin site-pages list. Plain module so server pages can read it (not 'use client'). */
export const PAGES_PATH = '/admin/pages' as Route;
