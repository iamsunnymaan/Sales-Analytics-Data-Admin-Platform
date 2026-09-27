# House of Beauty — Admin Portal

An internal Spring Boot admin application for managing and reporting on **Primary Sales**,
**Secondary Sales**, **Site/Store data**, and **Product data** for the House of Beauty brands
(Anastasia Beverly Hills, Kylie Cosmetics). It also includes its own login/RBAC system (users,
roles, page/section permissions, per-user feature toggles) and a generic CSV/XLSX data-upload +
Explorer tool for the underlying tables.

## Tech stack

- **Backend:** Java 17, Spring Boot 3.2.5 (Web, Data JPA/Hibernate, Validation), Maven
- **Database:** MySQL 8+ — see [Database](#database)
- **Auth:** Custom session-based login (BCrypt password hashing via `spring-security-crypto`,
  *not* the full Spring Security filter chain — see `pom.xml`'s comment on that dependency)
- **Frontend:** Static HTML/CSS/vanilla JS under `src/main/resources/static/` (no build step,
  no framework/bundler — served directly by Spring Boot)
- **File import/export:** Apache POI (XLSX), OpenCSV (CSV)

## Prerequisites

- JDK 17+ (the Maven build targets `--release 17`; a newer JDK on `PATH`/`JAVA_HOME` is fine as
  long as Lombok's `annotationProcessorPaths` entry in `pom.xml` stays in place — some newer
  `javac` versions no longer auto-discover annotation processors from the plain classpath)
- Maven (or just use the bundled `./mvnw` / `mvnw.cmd`)
- MySQL 8+

## Database

The application uses **MySQL**. `database/local-mysql-schema.sql` builds the full schema — apply it once
against a fresh MySQL database. `com.houseofbeauty.util.SqlDialect` holds the MySQL syntax used by the
hand-written SQL (identifier quoting, `LIMIT`, `ON DUPLICATE KEY UPDATE`, etc.).

```sql
CREATE DATABASE houseofbeauty CHARACTER SET utf8mb4;
CREATE USER 'hob_app'@'localhost' IDENTIFIED BY 'change-me';
GRANT ALL PRIVILEGES ON houseofbeauty.* TO 'hob_app'@'localhost';
```

```
mysql -u hob_app -p houseofbeauty < database/local-mysql-schema.sql
```

## Configuration

`src/main/resources/application.properties` holds settings shared by every environment (port
`8091`, session timeout, upload size caps, compression). Datasource credentials are **not**
committed — they live in a per-machine, gitignored file:

- `application-dev.properties` — active by default (`spring.profiles.active=dev`)
- `application-local.properties` — alternative local override, also gitignored
- `application-prod.properties` — production overrides (currently just a placeholder)

Create `src/main/resources/application-dev.properties` pointing at your own database, e.g. for
MySQL:

```properties
spring.datasource.url=jdbc:mysql://127.0.0.1:3306/houseofbeauty?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC
spring.datasource.username=hob_app
spring.datasource.password=change-me
spring.datasource.driver-class-name=com.mysql.cj.jdbc.Driver
```

## Running

```
./mvnw spring-boot:run
```

The app starts on **http://localhost:8091**. On first run against an empty database,
`AuthBootstrapSeeder` and `FeatureBootstrapSeeder` seed the default roles (`ADMIN`, `MANAGER`,
`VIEWER`, `SUPERADMIN`), the full permission/feature catalog, and one dev-only login per role:

| Username     | Password         | Role       |
|--------------|------------------|------------|
| `admin`      | `Admin@12345`    | ADMIN      |
| `manager`    | `Manager@12345`  | MANAGER    |
| `viewer`     | `Viewer@12345`   | VIEWER     |
| `superadmin` | `SuperAdmin@12345` | SUPERADMIN |

**Change these (or remove the seeder) before any real or shared use.**

## Pages

- **Dashboard** — cross-brand sales overview, daily trends, partner performance, product snapshot
- **Primary Sales / Secondary Sales** — overview, daily trends, product snapshot, reports
- **Site Insights** — site picker, geo map/compare, per-site detail
- **Team Insights** — team/person-level performance reports
- **Explorer** — generic browse/search/edit/export over the core data tables
- **Data Upload** — CSV/XLSX import with preview, validation, and commit history
- **IAM / Roles** — user, role, and page/section permission management
- **Monitoring** — login/upload/download/unauthorized-access audit trails
- **Super Admin** — top-level administrative console

## Project structure

```
src/main/java/com/houseofbeauty/
├── controller/    REST controllers, grouped by page/feature
├── service/       business logic (one package per page/feature)
├── model/         JPA entities
├── repository/    Spring Data JPA repositories
├── dto/           request/response records
├── config/        Spring configuration (filters, executors, etc.)
├── security/      permission annotations/interceptors
└── util/          small cross-cutting helpers (e.g. SqlDialect)

src/main/resources/static/   frontend (plain HTML/CSS/JS, one folder per page/component)
database/                    schema DDL, migrations, ER diagram
doc/                         architecture, testing, and performance-testing notes
Data/                        sample import templates (Product/Site Master, Primary/Secondary Sales)
```

See `doc/ARCHITECTURE.md` for the upload/import pipeline and key services, and
`doc/TESTING.md` / `doc/PERFORMANCE_TESTING.md` for test conventions and load-testing notes.

## Testing

```
./mvnw test
```

Tests are Mockito-based unit tests (no in-memory database — the app talks to MySQL
directly) under `src/test/java/com/houseofbeauty/service/`.
