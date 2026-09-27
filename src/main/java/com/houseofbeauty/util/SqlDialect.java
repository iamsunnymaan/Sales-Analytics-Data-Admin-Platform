package com.houseofbeauty.util;

import org.springframework.stereotype.Component;

// MySQL syntax for the handful of constructs the raw-SQL report/explorer services (TableAccessService,
// Dashboard/PrimarySales/SecondarySales/SiteDetail/TopProjection/Explorer) build by hand: identifier
// quoting, LIMIT/OFFSET pagination, DATE_ADD, CONCAT, and CAST to CHAR. Kept as one small component so
// those services don't each hardcode the syntax.
@Component
public class SqlDialect {

    // `identifier`
    public String quote(String identifier) {
        return "`" + identifier + "`";
    }

    // Current database name — used against INFORMATION_SCHEMA.TABLE_SCHEMA/COLUMNS.TABLE_SCHEMA.
    public String currentSchemaFn() {
        return "DATABASE()";
    }

    // DATE_ADD(expr, INTERVAL 1 DAY)
    public String dateAddOneDay(String expr) {
        return "DATE_ADD(" + expr + ", INTERVAL 1 DAY)";
    }

    // CAST(expr AS CHAR(n)) — used for LIKE searches / building a composite sort key.
    public String castText(String expr, int length) {
        return "CAST(" + expr + " AS CHAR(" + length + "))";
    }

    // CONCAT(a, b, c)
    public String concat(String... expressions) {
        return "CONCAT(" + String.join(", ", expressions) + ")";
    }

    // A single-character literal at code point 31 (Unit Separator).
    public String unitSeparatorLiteral() {
        return "CHAR(31)";
    }

    // Pagination clause taking (offset, count) as two bound parameters in that order.
    public String limitOffsetClause() {
        return "LIMIT ?, ?";
    }

    // MySQL has no TOP N: callers that previously prefixed the select list with topPrefix must append
    // limitSuffix(limit) after the statement's very last clause (ORDER BY, if present). topPrefix is
    // kept as an empty string so those call sites stay unchanged. limit is always a trusted
    // server-side int, never user-supplied SQL.
    public String topPrefix(long limit) {
        return "";
    }

    public String limitSuffix(long limit) {
        return " LIMIT " + limit;
    }

    // An AUTO_INCREMENT column always accepts an explicit value on INSERT, so there is nothing to
    // toggle — a harmless no-op statement.
    public String identityInsertToggle(String table, boolean on) {
        return "DO 0";
    }
}
