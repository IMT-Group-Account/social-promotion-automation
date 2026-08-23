export interface AuthenticatedUser {
  id: string;
}

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthenticatedUser;
}
