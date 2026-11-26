import type { Route } from 'next';

/** The admin notification inbox. Plain module so server pages can read it (not 'use client'). */
export const INBOX_PATH = '/admin/notifications' as Route;
