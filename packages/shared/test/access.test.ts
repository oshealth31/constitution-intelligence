import { describe, expect, it } from 'vitest';
import {
  ORGANISATION_PERMISSIONS,
  ORGANISATION_ROLES,
  ROLE_PERMISSIONS,
  canAssignRole,
  canManageMember,
  roleHasPermission,
} from '../src/access';

const WRITE_PERMISSIONS = [
  'organisation.settings.manage',
  'content.edit',
  'content.review',
  'content.approve',
  'members.invite',
  'members.manage',
  'branding.manage',
] as const;

describe('role permissions', () => {
  it('gives the Owner every organisation permission', () => {
    expect([...ROLE_PERMISSIONS.owner].sort()).toEqual([...ORGANISATION_PERMISSIONS].sort());
  });

  it('lets every role read its organisation and constitution', () => {
    for (const role of ORGANISATION_ROLES) {
      expect(roleHasPermission(role, 'organisation.read')).toBe(true);
      expect(roleHasPermission(role, 'constitution.read')).toBe(true);
    }
  });

  it('keeps the Auditor strictly read-only', () => {
    for (const permission of WRITE_PERMISSIONS) {
      expect(roleHasPermission('auditor', permission)).toBe(false);
    }
    expect(roleHasPermission('auditor', 'audit.read')).toBe(true);
    expect(roleHasPermission('auditor', 'members.read')).toBe(true);
  });

  it('gives a Member no management permissions', () => {
    expect(ROLE_PERMISSIONS.member).toEqual(['organisation.read', 'constitution.read']);
  });

  it('lets the Content Reviewer approve content but not manage people', () => {
    expect(roleHasPermission('content_reviewer', 'content.approve')).toBe(true);
    expect(roleHasPermission('content_reviewer', 'members.invite')).toBe(false);
  });

  it('does not let an Administrator approve content or change organisation settings', () => {
    expect(roleHasPermission('admin', 'content.approve')).toBe(false);
    expect(roleHasPermission('admin', 'organisation.settings.manage')).toBe(false);
  });
});

describe('privilege escalation rules', () => {
  it('allows only an Owner to grant the Owner role', () => {
    expect(canAssignRole('owner', 'owner')).toBe(true);
    expect(canAssignRole('admin', 'owner')).toBe(false);
  });

  it('lets an Administrator grant Administrator and lower roles', () => {
    expect(canAssignRole('admin', 'admin')).toBe(true);
    expect(canAssignRole('admin', 'content_reviewer')).toBe(true);
    expect(canAssignRole('admin', 'auditor')).toBe(true);
    expect(canAssignRole('admin', 'member')).toBe(true);
  });

  it('does not let roles without invite permission grant anything', () => {
    for (const actor of ['content_reviewer', 'member', 'auditor'] as const) {
      for (const target of ORGANISATION_ROLES) {
        expect(canAssignRole(actor, target)).toBe(false);
      }
    }
  });

  it('does not let an Administrator manage an Owner or another Administrator', () => {
    expect(canManageMember('admin', 'owner')).toBe(false);
    expect(canManageMember('admin', 'admin')).toBe(false);
    expect(canManageMember('admin', 'member')).toBe(true);
    expect(canManageMember('owner', 'owner')).toBe(true);
  });

  it('does not let read-only or member roles manage anyone', () => {
    for (const actor of ['content_reviewer', 'member', 'auditor'] as const) {
      expect(canManageMember(actor, 'member')).toBe(false);
    }
  });
});
