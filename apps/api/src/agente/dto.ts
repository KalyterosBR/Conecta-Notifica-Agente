// Contrato com o agente Go (ver apps/agent/README.md). As chaves são
// snake_case porque é o que o agente envia.
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class EventoDto {
  @IsString()
  @MaxLength(200)
  external_event_id: string;

  @IsString()
  @MaxLength(100)
  external_student_id: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  student_name?: string;

  @IsIn(['in', 'out'])
  direction: 'in' | 'out';

  @IsISO8601()
  occurred_at: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  card?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  device_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  location_id?: string;
}

export class LoteEventosDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EventoDto)
  events: EventoDto[];
}

export class AlunoDto {
  @IsString()
  @MaxLength(100)
  external_id: string;

  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  class_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  card?: string;

  @IsBoolean()
  active: boolean;
}

export class SyncAlunosDto {
  @IsBoolean()
  full: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AlunoDto)
  students: AlunoDto[];
}

export class HeartbeatDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  version?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  cursor?: string;

  @IsOptional()
  @IsInt()
  pending?: number;

  @IsOptional()
  @IsBoolean()
  db_ok?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  last_error?: string;

  @IsOptional()
  @IsISO8601()
  last_event_at?: string;

  @IsOptional()
  @IsInt()
  sent_today?: number;
}
