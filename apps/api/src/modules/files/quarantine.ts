import { ForbiddenException, GoneException } from '@nestjs/common';

export const QUARANTINED_MESSAGE =
  'This file is held for a safety check and cannot be downloaded at the moment.';
export const REMOVED_MESSAGE = 'This file was removed after a safety check.';

/**
 * Every path that hands out a stored file calls this first (downloads, a version's original
 * document, the portal logo). A quarantined file is refused; a removed one is gone.
 */
export function assertDownloadable(file: {
  quarantinedAt: Date | null;
  contentRemovedAt: Date | null;
}): void {
  if (file.contentRemovedAt) {
    throw new GoneException({ message: REMOVED_MESSAGE, reason: 'FILE_REMOVED' });
  }
  if (file.quarantinedAt) {
    throw new ForbiddenException({ message: QUARANTINED_MESSAGE, reason: 'FILE_QUARANTINED' });
  }
}
