import { BadRequestException, Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { loadBreachedPasswordList } from './breached-passwords';
import { checkPasswordPolicy, type PasswordContext } from './password-policy';

/**
 * Argon2id with the OWASP-recommended minimum settings (19 MiB memory, 2 iterations,
 * 1 lane). @node-rs/argon2 uses Argon2id by default.
 */
const HASH_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 };

@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | undefined;

  constructor() {
    // Load the leaked-password list at start-up, so a missing or damaged file stops the API
    // straight away instead of failing someone's password change later.
    loadBreachedPasswordList();
  }

  hash(password: string): Promise<string> {
    return hash(password, HASH_OPTIONS);
  }

  /**
   * Checks a password against a stored hash. When there is no account (or no password yet),
   * a dummy hash is still checked so the response takes the same time either way,
   * which stops attackers discovering which email addresses have accounts.
   */
  async verify(storedHash: string | null | undefined, password: string): Promise<boolean> {
    if (!storedHash) {
      this.dummyHash ??= hash('dummy-password-for-timing', HASH_OPTIONS);
      await verify(await this.dummyHash, password).catch(() => false);
      return false;
    }
    try {
      return await verify(storedHash, password);
    } catch {
      return false;
    }
  }

  /** Throws 400 with a plain-language message if the password breaks the policy. */
  assertAcceptable(password: string, context: PasswordContext): void {
    const problem = checkPasswordPolicy(password, context);
    if (problem) {
      throw new BadRequestException(problem);
    }
  }
}
