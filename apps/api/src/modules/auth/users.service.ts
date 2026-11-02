import { Inject, Injectable } from '@nestjs/common';
import { memberships, organisations, users, type Database, type User } from '@constitution/db';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../database/database.constants';

/** Safe public view of a user: never includes the password hash. */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  status: User['status'];
  isPlatformSuperAdmin: boolean;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    isPlatformSuperAdmin: user.isPlatformSuperAdmin,
  };
}

@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findByEmail(email: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return user;
  }

  /** Changes the caller's own display name. Email and role are not changeable here. */
  async updateDisplayName(id: string, displayName: string): Promise<User | undefined> {
    const [user] = await this.db
      .update(users)
      .set({ displayName, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async findById(id: string): Promise<User | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  }

  /** Active memberships in active organisations, for the "who am I" response. */
  listActiveMemberships(userId: string) {
    return this.db
      .select({
        membershipId: memberships.id,
        organisationId: organisations.id,
        organisationSlug: organisations.slug,
        organisationName: organisations.name,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(organisations, eq(memberships.organisationId, organisations.id))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.status, 'active'),
          eq(organisations.status, 'active'),
        ),
      )
      .orderBy(organisations.name);
  }
}
