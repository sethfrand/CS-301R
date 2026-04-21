#ifndef TOKEN_H
#define TOKEN_H

#include <string>

enum class TokenType {
    COMMA,
    ID,
    STRING,
    END
};

class Token {
public:
    Token(TokenType t, const std::string& val, int ln)
        : type(t), value(val), line(ln) {}

    std::string toString() const {
        return "(" + typeName() + ",\"" + value + "\"," + std::to_string(line) + ")";
    }

    std::string typeName() const {
        switch (type) {
            case TokenType::COMMA:  return "COMMA";
            case TokenType::ID:     return "ID";
            case TokenType::STRING: return "STRING";
            case TokenType::END:    return "END";
        }
        return "UNKNOWN";
    }

    TokenType getType() const { return type; }
    const std::string& getValue() const { return value; }
    int getLine() const { return line; }

private:
    TokenType type;
    std::string value;
    int line;
};

#endif // TOKEN_H
