import { apiRequest, ApiResponse } from './client.js';

export interface PermanentDeleteMandalRequest {
  pin: string;
  confirmed: boolean;
  confirmationPhrase: string;
}

export interface PermanentDeleteMandalResponse {
  message: string;
  registrationOpen: boolean;
}

export async function permanentDeleteMandal(
  data: PermanentDeleteMandalRequest
): Promise<ApiResponse<PermanentDeleteMandalResponse>> {
  return apiRequest<PermanentDeleteMandalResponse>('/organizations/permanent-delete', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
