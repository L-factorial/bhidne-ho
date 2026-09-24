import { ui } from '../i18n/copy.ts';
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
      ? ui("common.session_expired_the_server_may_have_restarted_sign_out_to_start_a_new_session")
      : typeof detail === 'string' ? detail
      : typeof detail?.detail === 'string' ? detail.detail
      : status >= 500 ? ui("feedback.the_server_could_not_complete_this_request_please_try_again")
      : ui("feedback.could_not_complete_this_request_please_try_again");
    throw new ApiError(status, message, detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : undefined);
  }
  if (invalidJson || !raw) throw new ApiError(status, ui("feedback.the_server_returned_an_unexpected_response_please_try_again"));
  return data as T;
}
