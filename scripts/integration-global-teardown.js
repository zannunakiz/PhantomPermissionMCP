'use strict';
module.exports = async () => {
  await require('./integration-test-db').teardown();
};