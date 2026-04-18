import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser } from './auth.guard';

export const ROLES_KEY = 'roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<string[]>(
      ROLES_KEY,
      context.getHandler(),
    );

    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    const hasRole = requiredRoles.includes(user.type);
    if (!hasRole) {
      throw new ForbiddenException(
        `User role '${user.type}' does not have access to this resource. Required roles: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
