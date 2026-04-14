-- Replace reader/author split roles with user/admin/superadmin roles.
ALTER TYPE "Role" RENAME TO "Role_old";

CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN', 'SUPERADMIN');

CREATE FUNCTION map_legacy_roles(old_roles "Role_old"[]) RETURNS "Role"[]
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT COALESCE(
    array_agg(DISTINCT mapped_role),
    ARRAY['USER']::"Role"[]
  )
  FROM (
    SELECT (
      CASE
        WHEN role_value::text IN ('READER', 'AUTHOR') THEN 'USER'
        ELSE role_value::text
      END
    )::"Role" AS mapped_role
    FROM unnest(old_roles) AS role_value
  ) AS normalized_roles;
$$;

ALTER TABLE "User"
ALTER COLUMN "roles" DROP DEFAULT;

ALTER TABLE "User"
ALTER COLUMN "roles" TYPE "Role"[]
USING map_legacy_roles("roles");

ALTER TABLE "User"
ALTER COLUMN "roles" SET DEFAULT ARRAY['USER']::"Role"[];

DROP FUNCTION map_legacy_roles("Role_old"[]);
DROP TYPE "Role_old";
