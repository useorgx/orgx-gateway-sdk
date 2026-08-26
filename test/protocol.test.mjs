import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SOURCE_SUB_TYPES,
  parseSourceSubType,
} from '../dist/protocol.js';

describe('source subtype protocol', () => {
  it('parses every supported attribution source including user-managed auth', () => {
    assert.deepEqual(SOURCE_SUB_TYPES, [
      'subscription',
      'api_key',
      'enterprise_key',
      'user_managed',
    ]);

    for (const sourceSubType of SOURCE_SUB_TYPES) {
      assert.equal(parseSourceSubType(sourceSubType), sourceSubType);
    }
  });

  it('rejects unknown, empty, and non-string source values', () => {
    for (const value of ['opaque_local_auth', '', null, 1, {}]) {
      assert.throws(
        () => parseSourceSubType(value),
        /source_sub_type must be one of: subscription, api_key, enterprise_key, user_managed/
      );
    }
  });
});
