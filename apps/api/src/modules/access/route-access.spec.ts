import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { IS_PUBLIC, REQUIRED_ORG_PERMISSION, REQUIRES_SUPER_ADMIN } from './decorators';

/**
 * Broken access control is usually a route someone forgot to protect. This test lists every
 * route of every controller and fails if one does not declare who may use it:
 *   - @Public() (no sign-in needed), or
 *   - @RequireSuperAdmin(), or
 *   - @RequireOrgPermission(...) on a route that names the organisation (:organisationId), or
 *   - it is one of the few "my own account" routes below, which need sign-in and act only on
 *     the signed-in person.
 * A new route that fits none of these must be given an access rule (or added here on purpose).
 */
const SIGNED_IN_SELF_ROUTES = new Set([
  'POST auth/logout',
  'POST auth/logout-all',
  'GET auth/me',
  'PATCH auth/me',
  'POST auth/password/change',
]);

const modules = {
  ...import.meta.glob('../**/*.controller.ts', { eager: true }),
  ...import.meta.glob('../../health/*.controller.ts', { eager: true }),
} as Record<string, Record<string, unknown>>;

interface Route {
  key: string;
  file: string;
  isPublic: boolean;
  superAdmin: boolean;
  permission: string | undefined;
}

function join(...parts: string[]): string {
  return parts
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .join('/');
}

function collectRoutes(): Route[] {
  const routes: Route[] = [];
  for (const [file, exports] of Object.entries(modules)) {
    for (const value of Object.values(exports)) {
      if (typeof value !== 'function') continue;
      const controller = value as { prototype: Record<string, unknown> };
      const basePath = Reflect.getMetadata(PATH_METADATA, controller) as string | undefined;
      if (basePath === undefined) continue;
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = controller.prototype[name];
        if (typeof handler !== 'function' || name === 'constructor') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
        if (method === undefined || path === undefined) continue;
        const read = (key: string) =>
          Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, controller);
        routes.push({
          key: `${RequestMethod[method]} ${join(basePath, ...[path].flat())}`,
          file,
          isPublic: read(IS_PUBLIC) === true,
          superAdmin: read(REQUIRES_SUPER_ADMIN) === true,
          permission: read(REQUIRED_ORG_PERMISSION) as string | undefined,
        });
      }
    }
  }
  return routes;
}

describe('route access rules', () => {
  const routes = collectRoutes();

  it('finds the application routes', () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.map((route) => route.key)).toContain('POST auth/login');
  });

  it('gives every route an explicit access rule', () => {
    const undeclared = routes
      .filter(
        (route) =>
          !route.isPublic &&
          !route.superAdmin &&
          !route.permission &&
          !SIGNED_IN_SELF_ROUTES.has(route.key),
      )
      .map((route) => `${route.key} (${route.file})`);
    expect(undeclared).toEqual([]);
  });

  it('checks organisation permissions only on routes that name the organisation', () => {
    const wrong = routes
      .filter((route) => route.permission && !route.key.includes(':organisationId'))
      .map((route) => route.key);
    expect(wrong).toEqual([]);
  });

  it('never makes an organisation or platform route public', () => {
    const exposed = routes
      .filter(
        (route) =>
          route.isPublic &&
          (route.key.includes(':organisationId') || route.key.includes('platform/')),
      )
      .map((route) => route.key);
    expect(exposed).toEqual([]);
  });

  it('keeps the public routes to the expected few', () => {
    const publicRoutes = routes
      .filter((route) => route.isPublic)
      .map((route) => route.key)
      .sort();
    expect(publicRoutes).toEqual(
      [
        'GET health/live',
        'GET health/ready',
        'GET portal/:slug',
        'GET portal/:slug/logo',
        'POST auth/login',
        'POST auth/password/forgot',
        'POST auth/password/reset',
        'POST invitations/accept',
      ].sort(),
    );
  });
});
