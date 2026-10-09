// Executed only by the local development mongo-init container.
try {
  rs.status();
} catch (error) {
  if (error.code !== 94 && error.codeName !== "NotYetInitialized") throw error;
  rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongo:27017" }] });
}
for (let attempt = 0; attempt < 60; attempt++) {
  if (db.adminCommand({ hello: 1 }).isWritablePrimary) {
    print("Local replica set is ready");
    quit(0);
  }
  sleep(1000);
}
throw new Error("Local replica set did not elect a primary within 60 seconds");
