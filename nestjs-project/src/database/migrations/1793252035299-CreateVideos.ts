import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideos1793252035299 implements MigrationInterface {
  name = 'CreateVideos1793252035299';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "videos" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "public_token" character varying(64) NOT NULL, "channel_id" uuid NOT NULL, "status" character varying NOT NULL DEFAULT 'draft', "title" character varying(255) NOT NULL, "original_filename" character varying(255) NOT NULL, "content_type" character varying(255) NOT NULL, "size_bytes" bigint NOT NULL, "object_key" character varying(1024) NOT NULL, "thumbnail_object_key" character varying(1024), "duration_seconds" integer, "metadata" jsonb, "multipart_upload_id" character varying(1024), "failure_reason" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_b89aa27c21fd1192d78981fb37a" UNIQUE ("public_token"), CONSTRAINT "PK_e4c86c0cf95aff16e9fb8220f6b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_023a8e4f3f1a34ff3d8ca04a4c" ON "videos" ("channel_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_023a8e4f3f1a34ff3d8ca04a4cc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_023a8e4f3f1a34ff3d8ca04a4c"`,
    );
    await queryRunner.query(`DROP TABLE "videos"`);
  }
}
