CREATE DATABASE tokenDB;

USE tokenDB;

CREATE TABLE tokens (
    id VARCHAR(255) PRIMARY KEY,
    symbol VARCHAR(255) CHARACTER SET utf8mb4,
    name VARCHAR(255) CHARACTER SET utf8mb4,
    address VARCHAR(255)
);

CREATE TABLE tokenPrices (
    id VARCHAR(255) PRIMARY KEY,
    price DECIMAL(10, 10),
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);