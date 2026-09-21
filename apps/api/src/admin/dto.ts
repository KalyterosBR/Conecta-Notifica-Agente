import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const STATUS_COBRANCA = ['em_dia', 'pendente', 'atrasado', 'isento'] as const;

export class CriarEscolaDto {
  @IsString()
  @MaxLength(200)
  nome: string;

  @IsEmail({}, { message: 'e-mail da direção inválido' })
  email: string;

  /** Só dígitos ou com máscara; guardamos limpo. */
  @IsOptional()
  @Matches(/^[\d./-]{14,18}$/, { message: 'CNPJ deve ter 14 dígitos' })
  cnpj?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  plano?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_alunos?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_chips?: number;
}

export class AtualizarEscolaDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nome?: string;

  @IsOptional()
  @Matches(/^[\d./-]{14,18}$/, { message: 'CNPJ deve ter 14 dígitos' })
  cnpj?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  plano?: string;

  /** null remove o teto. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  max_alunos?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  max_chips?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observacoes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  conta_azul_id?: string;
}

export class BloquearDto {
  @IsBoolean()
  bloqueado: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  motivo?: string;
}

/** Espelho do financeiro. Hoje preenchido à mão; depois, pelo Conta Azul. */
export class CobrancaDto {
  @IsOptional()
  @IsIn(STATUS_COBRANCA)
  status?: (typeof STATUS_COBRANCA)[number];

  @IsOptional()
  @IsBoolean()
  nota_emitida?: boolean;

  @IsOptional()
  @IsString()
  data_nota?: string;
}
