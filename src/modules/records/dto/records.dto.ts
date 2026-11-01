import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ShareCategory } from '@prisma/client';
import { CursorQueryDto } from '../../../common/pagination/pagination';
import { Trim } from '../../../common/validation/transforms';

export class ListRecordsQueryDto extends CursorQueryDto {
  /** Free-text search over type, summary and issuer name */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  q?: string;

  /** Exact match on the record's display type, e.g. "Blood Test Result" */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  type?: string;
}

export interface RecordView {
  id: string;
  type: string;
  category: ShareCategory;
  issuedBy: { id: string; name: string };
  /** YYYY-MM-DD */
  issuedDate: string;
  summary: string;
  /** Decrypted. Present on GET /records/:id only. */
  details?: string;
  receivedAt: string;
}
