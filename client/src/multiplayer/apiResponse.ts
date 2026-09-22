export class ApiError extends Error {
  status: number;
  detail?: { code?: string; match_id?: string; requires_leave_game?: boolean; departure_command?: 'abandon' | 'leave' };
  constructor(status: number, message: string, detail?: ApiError['detail']) {
    super(message); this.status = status; this.detail = detail;
  }
}

export function decodeApiResponse<T>(raw: string, status: number): T {
  if (status === 204) return undefined as T;
  let data: any;
  let invalidJson = false;
  if (raw) {
    try { data = JSON.parse(raw); } catch { invalidJson = true; }
  }
  if (status < 200 || status >= 300) {
    const detail = data?.detail;
    const message = status === 401
      ? 'Session expired. The server may have restarted. Sign out to start a new session.'
      : typeof detail === 'string' ? detail
      : typeof detail?.detail === 'string' ? detail.detail
      : status >= 500 ? 'The server could not complete this request. Please try again.'
      : 'Could not complete this request. Please try again.';
    throw new ApiError(status, message, detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : undefined);
  }
  if (invalidJson || !raw) throw new ApiError(status, 'The server returned an unexpected response. Please try again.');
  return data as T;
}
