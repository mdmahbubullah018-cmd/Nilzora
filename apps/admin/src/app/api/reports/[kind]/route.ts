import { REPORT_KINDS, reportExportQuerySchema } from '@nilzora/contracts';
import { ApiError } from '@nilzora/web-session';
import { NextResponse, type NextRequest } from 'next/server';
import { fileResponse, isCrossSite, refusal } from '@/lib/download';
import { session } from '@/lib/session';
import { signInPath } from '@/lib/workspace-access';

/*
 * GET /api/reports/:kind?format=csv|xlsx|pdf&from=&to=&…
 * --------------------------------------------------------
 * Downloads a report with the current filters. The API checks the report's permission,
 * builds the file and audits the download. A report too big to stream sends the visitor
 * to the Reports page, where a background export can be started (a POST with CSRF —
 * never from this GET).
 */
export async function GET(request: NextRequest, context: { params: Promise<{ kind: string }> }) {
  if (isCrossSite(request)) return refusal(403, 'Downloads must start from the Nilzora admin.');
  const { kind: raw } = await context.params;
  const kind = REPORT_KINDS.find((candidate) => candidate === raw);
  if (!kind) return refusal(404, 'There is no such report.');

  const parsed = reportExportQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success)
    return refusal(400, 'The report filters are not valid. Go back and try again.');

  try {
    const result = await session.read((api, token) =>
      api.adminDownloadReport(token, kind, parsed.data),
    );
    if (result.kind === 'signed_out') {
      return NextResponse.redirect(new URL(signInPath('/admin/reports'), request.url));
    }
    if (result.kind !== 'ok') {
      return refusal(503, 'The API could not be reached. Try again in a moment.');
    }
    return fileResponse(result.value, `nilzora-${kind}.${parsed.data.format}`);
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.code === 'export_too_large') {
        const back = new URL('/admin/reports', request.url);
        for (const [name, value] of request.nextUrl.searchParams)
          back.searchParams.set(name, value);
        back.searchParams.set('kind', kind);
        back.searchParams.set('tooLarge', '1');
        return NextResponse.redirect(back, 303);
      }
      if (error.status === 403) return refusal(403, 'Your account may not download this report.');
      if (error.status === 429)
        return refusal(429, 'Too many downloads. Wait a moment, then try again.');
      if (error.status === 400) return refusal(400, 'The report filters are not valid.');
    }
    return refusal(503, 'The report could not be created right now. Try again in a moment.');
  }
}
