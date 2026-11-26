import { ApiError } from '@nilzora/web-session';
import { NextResponse, type NextRequest } from 'next/server';
import { fileResponse, isCrossSite, refusal } from '@/lib/download';
import { session } from '@/lib/session';
import { signInPath } from '@/lib/workspace-access';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/*
 * GET /api/exports/:jobId — the file of a finished background export. Only the account
 * that created the job may download it, and only while it still holds the report's
 * permission; the API checks both and audits the download.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  if (isCrossSite(request)) return refusal(403, 'Downloads must start from the Nilzora admin.');
  const { jobId } = await context.params;
  if (!UUID.test(jobId)) return refusal(404, 'There is no such export.');

  try {
    const result = await session.read((api, token) => api.adminDownloadExport(token, jobId));
    if (result.kind === 'signed_out') {
      return NextResponse.redirect(new URL(signInPath('/admin/reports'), request.url));
    }
    if (result.kind !== 'ok') {
      return refusal(503, 'The API could not be reached. Try again in a moment.');
    }
    return fileResponse(result.value, 'nilzora-export');
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404) return refusal(404, 'There is no such export.');
      if (error.status === 403) return refusal(403, 'Your account may not download this export.');
      if (error.status === 409) return refusal(409, 'This export is not ready yet.');
      if (error.status === 410) return refusal(410, 'This export has expired. Create it again.');
    }
    return refusal(503, 'The export could not be downloaded right now. Try again in a moment.');
  }
}
