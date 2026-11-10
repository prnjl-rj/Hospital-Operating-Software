import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import {
  HospitalRole,
  JwtUserPayload,
  hasPermission,
  verifyJwtToken,
} from './security.utils';

export const IS_PUBLIC_KEY = 'hos:isPublic';
export const ROLES_KEY = 'hos:roles';
export const PERMISSIONS_KEY = 'hos:permissions';
export const INTERNAL_S2S_KEY = 'hos:internalS2S';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const Roles = (...roles: HospitalRole[]) => SetMetadata(ROLES_KEY, roles);
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);
export const InternalS2S = () => SetMetadata(INTERNAL_S2S_KEY, true);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const cls = context.getClass();
    const isPublic =
      Reflect.getMetadata(IS_PUBLIC_KEY, handler) || Reflect.getMetadata(IS_PUBLIC_KEY, cls);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const isInternalS2S =
      Reflect.getMetadata(INTERNAL_S2S_KEY, handler) || Reflect.getMetadata(INTERNAL_S2S_KEY, cls);

    const internalTokenHeader = req.headers['x-internal-service-token'];
    const expectedInternalToken = process.env.INTERNAL_SERVICE_TOKEN || 'hos_internal_s2s_zero_trust_token_2026';
    if (isInternalS2S && internalTokenHeader && internalTokenHeader === expectedInternalToken) {
      req.user = {
        sub: 'system-internal-service',
        email: 's2s@hos.internal',
        username: 's2s',
        fullName: 'Internal Microservice Caller',
        hospitalId: (req.headers['x-hospital-id'] as string) || 'hosp-main-001',
        roles: ['SUPER_ADMIN'],
        permissions: ['*'],
        sessionId: 's2s-session',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
      } satisfies JwtUserPayload;
      return true;
    }

    const authHeader: string | undefined = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('MISSING_BEARER_TOKEN');
    }

    const token = authHeader.slice('Bearer '.length).trim();
    const secret = process.env.JWT_ACCESS_SECRET || 'hos_dev_jwt_access_secret_key_2026_enterprise_safe';
    try {
      const payload = verifyJwtToken(token, secret);
      req.user = payload;
      return true;
    } catch (err) {
      throw new UnauthorizedException((err as Error).message || 'INVALID_ACCESS_TOKEN');
    }
  }
}

@Injectable()
export class RbacPermissionsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const cls = context.getClass();
    const isPublic =
      Reflect.getMetadata(IS_PUBLIC_KEY, handler) || Reflect.getMetadata(IS_PUBLIC_KEY, cls);
    if (isPublic) return true;

    const requiredRoles: HospitalRole[] | undefined =
      Reflect.getMetadata(ROLES_KEY, handler) || Reflect.getMetadata(ROLES_KEY, cls);
    const requiredPermissions: string[] | undefined =
      Reflect.getMetadata(PERMISSIONS_KEY, handler) || Reflect.getMetadata(PERMISSIONS_KEY, cls);

    const req = context.switchToHttp().getRequest();
    const user: JwtUserPayload | undefined = req.user;
    if (!user) {
      throw new UnauthorizedException('UNAUTHENTICATED_CONTEXT');
    }

    // 1. Hospital Tenant Scope Isolation (Resource-Level Authorization)
    const targetHospitalId =
      req.params?.hospitalId || req.body?.hospitalId || req.query?.hospitalId;
    if (
      targetHospitalId &&
      !user.roles.includes('SUPER_ADMIN') &&
      targetHospitalId !== user.hospitalId
    ) {
      throw new ForbiddenException('CROSS_HOSPITAL_TENANT_ACCESS_DENIED');
    }

    // 2. Role Check
    if (requiredRoles && requiredRoles.length > 0) {
      const hasRole =
        user.roles.includes('SUPER_ADMIN') ||
        requiredRoles.some((r) => user.roles.includes(r));
      if (!hasRole) {
        throw new ForbiddenException(`REQUIRED_ROLE_MISSING: [${requiredRoles.join(', ')}]`);
      }
    }

    // 3. Permission Check
    if (requiredPermissions && requiredPermissions.length > 0) {
      const allGranted = requiredPermissions.every((perm) =>
        hasPermission(user.permissions, perm),
      );
      if (!allGranted) {
        throw new ForbiddenException(
          `REQUIRED_PERMISSION_MISSING: [${requiredPermissions.join(', ')}]`,
        );
      }
    }

    return true;
  }
}

