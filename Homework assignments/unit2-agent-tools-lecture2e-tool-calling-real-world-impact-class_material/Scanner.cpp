#include "Scanner.h"
#include <cctype>

Scanner::Scanner(const std::string& in)
    : input(in), pos(0), line(1) {}

void Scanner::skipWhitespace() {
    while (!isAtEnd()) {
        char c = peek();
        if (c == ' ' || c == '\t' || c == '\r') {
            pos++;
        } else if (c == '\n') {
            pos++;
            line++;
        } else {
            break;
        }
    }
}

char Scanner::peek() const {
    if (pos >= input.size()) return '\0';
    return input[pos];
}

bool Scanner::isAtEnd() const {
    return pos >= input.size();
}

Token Scanner::scanToken() {
    skipWhitespace();

    if (isAtEnd()) {
        return Token(TokenType::END, "", line);
    }

    char c = peek();

    // COMMA
    if (c == ',') {
        pos++;
        return Token(TokenType::COMMA, ",", line);
    }

    // STRING: "..."  (basic, no escape handling)
    if (c == '"') {
        pos++; // skip opening quote
        std::string value;
        while (!isAtEnd()) {
            char ch = peek();
            if (ch == '"') {
                pos++; // skip closing quote
                break;
            } else {
                value += ch;
                pos++;
            }
            if (ch == '\n') {
                line++;
            }
        }
        return Token(TokenType::STRING, value, line);
    }

    // ID: letters, digits, underscore; start with letter or underscore
    if (std::isalpha(static_cast<unsigned char>(c)) || c == '_') {
        std::string value;
        while (!isAtEnd()) {
            char ch = peek();
            if (std::isalnum(static_cast<unsigned char>(ch)) || ch == '_') {
                value += ch;
                pos++;
            } else {
                break;
            }
        }
        return Token(TokenType::ID, value, line);
    }

    // Unknown character: skip it and continue (emit as a simple ID for visibility)
    pos++;
    return Token(TokenType::ID, std::string(1, c), line);
}
