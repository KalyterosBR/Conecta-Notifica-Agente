// DTOs do painel da escola. Telefones sempre em E.164 (doc §3).
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const E164 = /^\+[1-9]\d{7,14}$/;

export class FiltroAlunosDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  busca?: string;

  @IsOptional()
  @IsIn(['1', 'true'])
  sem_responsavel?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;
}

export class CriarResponsavelDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  @Matches(E164, { message: 'phone deve estar em E.164, ex.: +5511999990000' })
  phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  relation?: string;

  /** Consentimento LGPD registrado no ato do cadastro. */
  @IsBoolean()
  opt_in: boolean;

  @IsArray()
  @IsString({ each: true })
  student_ids: string[];

  @IsOptional()
  @IsBoolean()
  notify_entry?: boolean;

  @IsOptional()
  @IsBoolean()
  notify_exit?: boolean;
}

export class AtualizarResponsavelDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @Matches(E164, { message: 'phone deve estar em E.164' })
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  relation?: string;

  /** true registra opt-in agora; false registra opt-out agora. */
  @IsOptional()
  @IsBoolean()
  opt_in?: boolean;
}

export class AtualizarVinculoDto {
  @IsOptional()
  @IsBoolean()
  notify_entry?: boolean;

  @IsOptional()
  @IsBoolean()
  notify_exit?: boolean;
}

export class FiltroEnviosDto {
  @IsOptional()
  @IsIn(['queued', 'sent', 'delivered', 'read', 'failed'])
  status?: string;

  @IsOptional()
  @IsString()
  de?: string; // ISO date

  @IsOptional()
  @IsString()
  ate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;
}

export class AtualizarRegrasDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  dedupe_minutes?: number;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  window_start?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  window_end?: string;

  @IsOptional()
  @IsBoolean()
  notify_weekends?: boolean;
}

export class ConectarWhatsappDto {
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(300)
  base_url: string;

  @IsString()
  @MaxLength(300)
  token: string;
}

export class IniciarConexaoDto {
  /**
   * Opcional. Sem telefone a UAZAPI devolve QR code; com telefone, devolve
   * código de pareamento — saída para quem não consegue escanear.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\+?\d{10,15}$/, { message: 'telefone deve ter DDI e DDD, ex: +5581999990000' })
  telefone?: string;

  /** Sem id, acrescenta um chip; com id, reconecta o chip informado. */
  @IsOptional()
  @IsUUID()
  instancia_id?: string;

  /** Apelido do chip no painel ("secretaria", "portaria"). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string;
}

export class FiltroRelatorioDto {
  /** Janela do relatório. 7, 30 ou 90 dias — o painel oferece esses três. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(180)
  dias?: number;
}

export class FiltroResponsaveisDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  busca?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  /** Só quem ainda não deu opt-in — a fila de pendências da LGPD. */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  sem_opt_in?: boolean;
}

export class VincularDto {
  @IsUUID()
  student_id: string;

  @IsOptional()
  @IsBoolean()
  notify_entry?: boolean;

  @IsOptional()
  @IsBoolean()
  notify_exit?: boolean;
}

export class LinhaImportacaoDto {
  /** ID do aluno na catraca — é por ele que a planilha casa com o cadastro. */
  @IsString()
  @MaxLength(100)
  aluno_external_id: string;

  @IsString()
  @MaxLength(200)
  nome: string;

  @IsString()
  @MaxLength(40)
  telefone: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  parentesco?: string;
}

export class ImportarResponsaveisDto {
  @IsArray()
  @ArrayMaxSize(2000, { message: 'importe no máximo 2000 linhas por vez' })
  @ValidateNested({ each: true })
  @Type(() => LinhaImportacaoDto)
  linhas: LinhaImportacaoDto[];

  /**
   * Marca opt-in de quem for criado. A escola declara que já tem o
   * consentimento — sem isso o worker não envia (doc §2.4).
   */
  @IsOptional()
  @IsBoolean()
  opt_in?: boolean;
}

export class DesconectarChipDto {
  /** Sem id, desconecta o chip conectado (caso simples, de um número só). */
  @IsOptional()
  @IsUUID()
  instancia_id?: string;
}

export class SalvarModeloDto {
  /** Corpo com as variáveis {responsavel} {aluno} {hora} {escola}. */
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  body: string;
}
