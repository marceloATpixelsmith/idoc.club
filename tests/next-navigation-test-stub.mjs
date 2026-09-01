function redirectError(destination, type = 'replace', status = 307) {
  const error = new Error('NEXT_REDIRECT');
  error.digest = `NEXT_REDIRECT;${type};${destination};${status};`;
  return error;
}

export function redirect(destination) {
  throw redirectError(destination);
}

export function permanentRedirect(destination) {
  throw redirectError(destination, 'replace', 308);
}

export function notFound() {
  const error = new Error('NEXT_HTTP_ERROR_FALLBACK;404');
  error.digest = 'NEXT_HTTP_ERROR_FALLBACK;404';
  throw error;
}
