// Loaded before test imports. Never read the project's deployment environment.
process.env.NODE_ENV = "test";
process.env.USE_REAL_REDIS = "false";
process.env.TOKEN_KEY = "isolated-test-only-signing-key";
process.env.KAFKA_BROKERS = "";
process.env.KAFKA_CREATE_TOPICS = "false";
process.env.MAIL_DELIVERY = "disabled";
process.env.GEMINI_API_KEY = "";
process.env.REQUIRE_BOOKING_OTP = "false";
process.env.INITIAL_USER_WALLET_BALANCE = "1000";
delete process.env.DATABASE_URL;
