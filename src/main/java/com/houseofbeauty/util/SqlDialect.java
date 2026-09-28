package com.houseofbeauty.util;

import org.springframework.stereotype.Component;

@Component
public class SqlDialect {

    public String quote(String identifier) {
        return "`" + identifier + "`";
    }

    public String currentSchemaFn() {
        return "DATABASE()";
    }

    public String dateAddOneDay(String expr) {
        return "DATE_ADD(" + expr + ", INTERVAL 1 DAY)";
    }

    public String castText(String expr, int length) {
        return "CAST(" + expr + " AS CHAR(" + length + "))";
    }

    public String concat(String... expressions) {
        return "CONCAT(" + String.join(", ", expressions) + ")";
    }

    public String unitSeparatorLiteral() {
        return "CHAR(31)";
    }

    public String limitOffsetClause() {
        return "LIMIT ?, ?";
    }

    public String topPrefix(long limit) {
        return "";
    }

    public String limitSuffix(long limit) {
        return " LIMIT " + limit;
    }

    public String identityInsertToggle(String table, boolean on) {
        return "DO 0";
    }
}
