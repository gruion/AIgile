// No-op auth helpers for opensource version (no auth required)

export async function getAuthToken(request) {
  return null;
}

export async function loginInBrowser(page, request) {
  // No auth needed in opensource — just navigate to the page
}
