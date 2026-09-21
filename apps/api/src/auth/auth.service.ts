import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { conferirSenha } from './senha';

export interface SessaoDto {
  token: string;
  user: { id: string; name: string; email: string; role: string; school_id: string | null };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, senha: string): Promise<SessaoDto> {
    const usuario = await this.prisma.user.findUnique({ where: { email } });
    if (!usuario || !conferirSenha(senha, usuario.passwordHash)) {
      // Mensagem única para e-mail e senha: não revelar qual falhou.
      throw new UnauthorizedException('credenciais inválidas');
    }
    const token = await this.jwt.signAsync({
      sub: usuario.id,
      schoolId: usuario.schoolId,
      role: usuario.role,
      name: usuario.name,
    });
    return {
      token,
      user: {
        id: usuario.id,
        name: usuario.name,
        email: usuario.email,
        role: usuario.role,
        school_id: usuario.schoolId,
      },
    };
  }
}
