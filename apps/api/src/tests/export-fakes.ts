import { randomUUID } from 'node:crypto';
import {
  REPORT_DEFINITIONS,
  type ExportFormat,
  type ExportJob,
  type ReportFilters,
  type ReportKind,
} from '@nilzora/contracts';
import { toAdminStoreError } from '../modules/admin/errors';
import type { OrderDocument, OrderDocumentKind } from '../modules/exports/documents';
import type { ReportRow } from '../modules/exports/format';
import type {
  ExportJobStore,
  ExportWorkerBackend,
  JobFile,
  ReportPage,
  ReportStore,
} from '../modules/exports/store';
import type { FakeIdentity } from './fakes';

/*
 * In-memory stand-ins for admin_report, admin_audit_export, admin_order_document and the
 * export-job functions. Like the database they check the CALLER's effective permission for
 * the report kind (NZ403), keep jobs per creator (NZ404 for anyone else), refuse a file
 * that is not ready (NZ443) or expired (NZ444), and record audit rows. The SQL itself is
 * covered by supabase/tests/reports_exports.test.sql.
 */

function raise(code: string): never {
  throw toAdminStoreError(
    { code, message: 'internal detail: private.report_range', details: null },
    'fake',
  );
}

interface FakeJob {
  id: string;
  kind: ReportKind;
  format: ExportFormat;
  filters: ReportFilters;
  status: ExportJob['status'];
  progress: number;
  rowCount: number | null;
  file: Buffer | null;
  fileName: string | null;
  contentType: string | null;
  error: string | null;
  createdBy: string;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  expiresAt: Date;
}

const DAY_MS = 86_400_000;

export class FakeExports {
  /** Rows each kind answers (all of them, before paging). */
  readonly rows: Partial<Record<ReportKind, ReportRow[]>> = {};
  /** A total to answer instead of the row count (to simulate very large reports). */
  totalOverride: number | undefined;
  readonly summaries: Partial<Record<ReportKind, Record<string, number>>> = {};
  readonly documents = new Map<string, OrderDocument>();
  readonly audits: { actorId: string; action: string; details: Record<string, unknown> }[] = [];
  readonly jobs: FakeJob[] = [];
  readonly reads: { userId: string; kind: ReportKind; limit: number; offset: number }[] = [];
  /** The database clock. */
  now = new Date('2026-11-02T10:00:00.000Z');

  constructor(
    private readonly identity: FakeIdentity,
    /** Records the call (and throws a queued failure), as FakeAdmin.enter does. */
    private readonly enter: (operation: string) => void,
  ) {}

  private userOf(accessToken: string) {
    const user = this.identity.userFor(accessToken);
    if (!user) raise('42501');
    return user;
  }

  private permitted(userId: string, kind: ReportKind): boolean {
    const user = this.identity.users.get(userId);
    return (
      user !== undefined &&
      user.status === 'active' &&
      this.identity.permissionsOf(user).has(REPORT_DEFINITIONS[kind].permission)
    );
  }

  private page(userId: string, kind: ReportKind, limit: number, offset: number): ReportPage {
    if (!this.permitted(userId, kind)) raise('NZ403');
    this.reads.push({ userId, kind, limit, offset });
    const all = this.rows[kind] ?? [];
    return {
      rows: all.slice(offset, offset + limit),
      total: this.totalOverride ?? all.length,
      summary: this.summaries[kind] ?? {},
      chart: [],
    };
  }

  private json(job: FakeJob): ExportJob {
    const expired =
      job.status === 'expired' || (job.status === 'done' && job.expiresAt <= this.now);
    return {
      id: job.id,
      kind: job.kind,
      format: job.format,
      filters: job.filters,
      status: expired ? 'expired' : job.status,
      progress: job.progress,
      rowCount: job.rowCount,
      fileName: job.fileName,
      contentType: job.contentType,
      fileBytes: job.file?.length ?? null,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
      expiresAt: job.expiresAt.toISOString(),
    };
  }

  /** Adds a finished job for `userId` (for routes that need one). */
  seedDoneJob(userId: string, kind: ReportKind = 'orders'): string {
    const id = randomUUID();
    this.jobs.push({
      id,
      kind,
      format: 'csv',
      filters: { from: '2026-10-01', to: '2026-10-31' },
      status: 'done',
      progress: 100,
      rowCount: 1,
      file: Buffer.from('﻿Order\r\nNZ100001\r\n', 'utf8'),
      fileName: `nilzora-${kind}-2026-10-01-to-2026-10-31.csv`,
      contentType: 'text/csv; charset=utf-8',
      error: null,
      createdBy: userId,
      createdAt: this.now,
      startedAt: this.now,
      finishedAt: this.now,
      expiresAt: new Date(this.now.getTime() + 7 * DAY_MS),
    });
    return id;
  }

  readonly reports: ReportStore = {
    read: (accessToken, _userId, kind, _filters, { limit, offset }) => {
      this.enter('reports.read');
      return Promise.resolve(this.page(this.userOf(accessToken).id, kind, limit, offset));
    },
    auditDownload: (accessToken, _userId, kind, format, rowCount, filters) => {
      this.enter('reports.audit');
      const user = this.userOf(accessToken);
      if (!this.permitted(user.id, kind)) raise('NZ403');
      this.audits.push({
        actorId: user.id,
        action: 'export.downloaded',
        details: { kind, format, rowCount, filters },
      });
      return Promise.resolve();
    },
    orderDocument: (accessToken, _userId, orderNumber, kind: OrderDocumentKind) => {
      this.enter('reports.document');
      const user = this.userOf(accessToken);
      if (!this.identity.permissionsOf(user).has('orders.read')) raise('NZ403');
      const document = this.documents.get(orderNumber);
      if (!document) raise('NZ404');
      this.audits.push({
        actorId: user.id,
        action: kind === 'invoice' ? 'order.invoice_downloaded' : 'order.packing_slip_downloaded',
        details: { orderNumber },
      });
      return Promise.resolve(document);
    },
  };

  readonly jobStore: ExportJobStore = {
    create: (accessToken, _userId, { kind, format, filters }) => {
      this.enter('jobs.create');
      const user = this.userOf(accessToken);
      if (!this.permitted(user.id, kind)) raise('NZ403');
      const job: FakeJob = {
        id: randomUUID(),
        kind,
        format,
        filters,
        status: 'queued',
        progress: 0,
        rowCount: null,
        file: null,
        fileName: null,
        contentType: null,
        error: null,
        createdBy: user.id,
        createdAt: this.now,
        startedAt: null,
        finishedAt: null,
        expiresAt: new Date(this.now.getTime() + 7 * DAY_MS),
      };
      this.jobs.push(job);
      this.audits.push({
        actorId: user.id,
        action: 'export.created',
        details: { kind, format, rowCount: null, filters },
      });
      return Promise.resolve(this.json(job));
    },
    list: (accessToken) => {
      this.enter('jobs.list');
      const user = this.userOf(accessToken);
      return Promise.resolve(
        this.jobs
          .filter((job) => job.createdBy === user.id)
          .reverse()
          .map((job) => this.json(job)),
      );
    },
    get: (accessToken, _userId, id) => {
      this.enter('jobs.get');
      const user = this.userOf(accessToken);
      const job = this.jobs.find(
        (candidate) => candidate.id === id && candidate.createdBy === user.id,
      );
      if (!job) raise('NZ404');
      return Promise.resolve(this.json(job));
    },
    download: (accessToken, _userId, id) => {
      this.enter('jobs.download');
      const user = this.userOf(accessToken);
      const job = this.jobs.find(
        (candidate) => candidate.id === id && candidate.createdBy === user.id,
      );
      if (!job) raise('NZ404');
      if (!this.permitted(user.id, job.kind)) raise('NZ403');
      if (job.status === 'expired' || (job.status === 'done' && job.expiresAt <= this.now)) {
        raise('NZ444');
      }
      if (job.status !== 'done' || !job.file || !job.fileName || !job.contentType) raise('NZ443');
      this.audits.push({
        actorId: user.id,
        action: 'export.downloaded',
        details: {
          kind: job.kind,
          format: job.format,
          rowCount: job.rowCount,
          filters: job.filters,
        },
      });
      const file: JobFile = {
        file: job.file,
        fileName: job.fileName,
        contentType: job.contentType,
        rowCount: job.rowCount ?? 0,
        kind: job.kind,
        format: job.format,
      };
      return Promise.resolve(file);
    },
  };

  /** Progress values the worker reported, per job. */
  readonly progressLog: { id: string; percent: number }[] = [];

  readonly worker: ExportWorkerBackend = {
    claim: () => {
      const job = this.jobs.find((candidate) => candidate.status === 'queued');
      if (!job) return Promise.resolve(null);
      Object.assign(job, { status: 'running', startedAt: this.now, progress: 0 });
      return Promise.resolve({
        id: job.id,
        kind: job.kind,
        format: job.format,
        filters: job.filters,
        createdBy: job.createdBy,
      });
    },
    readAs: (userId, kind, _filters, { limit, offset }) =>
      Promise.resolve(this.page(userId, kind, limit, offset)),
    progress: (id, percent) => {
      this.progressLog.push({ id, percent });
      const job = this.jobs.find((candidate) => candidate.id === id);
      if (job?.status === 'running') job.progress = percent;
      return Promise.resolve();
    },
    finish: (id, file) => {
      const job = this.jobs.find((candidate) => candidate.id === id);
      if (job?.status === 'running') {
        Object.assign(job, {
          status: 'done',
          progress: 100,
          file: file.body,
          fileName: file.fileName,
          contentType: file.contentType,
          rowCount: file.rowCount,
          finishedAt: this.now,
          expiresAt: new Date(this.now.getTime() + 7 * DAY_MS),
        });
      }
      return Promise.resolve();
    },
    fail: (id, message) => {
      const job = this.jobs.find((candidate) => candidate.id === id);
      if (job) Object.assign(job, { status: 'failed', error: message, finishedAt: this.now });
      return Promise.resolve();
    },
    expire: () => {
      let count = 0;
      for (const job of this.jobs) {
        if (['done', 'failed', 'queued'].includes(job.status) && job.expiresAt <= this.now) {
          Object.assign(job, { status: 'expired', file: null });
          count += 1;
        }
      }
      return Promise.resolve(count);
    },
  };
}

/** A complete invoice/packing-slip payload for one order. */
export function sampleDocument(orderNumber: string): OrderDocument {
  return {
    store: {
      name: 'Nilzora',
      addressLine: 'House 7, Road 2',
      addressArea: 'Banani',
      addressDistrict: 'Dhaka',
      phone: '+8801700000000',
      email: 'hello@nilzora.example',
    },
    order: {
      orderNumber,
      placedAt: '2026-10-25T08:00:00+00:00',
      status: 'pending',
      paymentMethod: 'cod',
      paymentStatus: 'pending',
      itemCount: 3,
      subtotalMinor: 30_000,
      discountMinor: 2_000,
      shippingFeeMinor: 6_000,
      totalMinor: 34_000,
      customerNote: 'Please call (before) noon',
    },
    delivery: {
      recipientName: 'Rahima Khatun',
      phone: '+8801712345678',
      addressLine: 'House 12, Road 5',
      area: 'Dhanmondi',
      district: 'Dhaka',
      division: 'Dhaka',
      postalCode: '1209',
      landmark: null,
      zone: 'inside_dhaka',
    },
    items: [
      {
        name: 'Desk Lamp',
        variantLabel: 'Colour: Navy',
        sku: 'DESK-LAMP-NV',
        quantity: 2,
        unitPriceMinor: 10_000,
        lineTotalMinor: 20_000,
      },
      {
        name: 'Clay Vase',
        variantLabel: null,
        sku: 'CLAY-VASE',
        quantity: 1,
        unitPriceMinor: 10_000,
        lineTotalMinor: 10_000,
      },
    ],
  };
}
