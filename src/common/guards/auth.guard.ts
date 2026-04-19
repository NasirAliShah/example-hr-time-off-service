import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

export interface AuthenticatedUser {
  id: string;
  type: 'employee' | 'manager' | 'admin';
  token: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Authorization header is required');
    }

    const token = authHeader.replace('Bearer ', '');

    if (!token) {
      throw new UnauthorizedException('Bearer token is required');
    }

    const user = this.validateToken(token);
    request.user = user;

    return true;
  }

  private validateToken(token: string): AuthenticatedUser {
    // Validate token format
    if (!token || token.length < 3) {
      throw new UnauthorizedException('Invalid token format');
    }

    // Parse token: format is "type-id" (e.g., "emp-1", "mgr-1", "admin-1")
    const parts = token.split('-');
    if (parts.length < 2) {
      throw new UnauthorizedException('Invalid token format');
    }

    const [type, ...idParts] = parts;
    const id = idParts.join('-');

    if (!id) {
      throw new UnauthorizedException('Invalid token format');
    }

    // Validate token type
    let userType: 'employee' | 'manager' | 'admin';
    switch (type) {
      case 'emp':
        userType = 'employee';
        break;
      case 'mgr':
        userType = 'manager';
        break;
      case 'admin':
        userType = 'admin';
        break;
      default:
        throw new UnauthorizedException('Invalid token type');
    }

    return {
      id,
      type: userType,
      token,
    };
  }
}
