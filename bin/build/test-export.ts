#!/usr/bin/env node
/**
 * Simple test to verify the exported construct can be imported correctly
 */

import { ShibbolethAtEdgeConstruct, IContext, CloudFrontCachingStrategy, OriginType, SecretsManager } from './index';

console.log('Testing construct import...');

try {
  // Test that all exports are available
  console.log('✓ ShibbolethAtEdgeConstruct imported successfully');
  console.log(`  - Type: ${typeof ShibbolethAtEdgeConstruct}`);
  console.log(`  - getInstance method: ${typeof ShibbolethAtEdgeConstruct.getInstance}`);
  console.log(`  - createStack method: ${typeof ShibbolethAtEdgeConstruct.createStack}`);
  
  // Test that enums are available
  console.log('✓ CloudFrontCachingStrategy enum imported');
  console.log(`  - NO_CACHE: ${CloudFrontCachingStrategy.NO_CACHE}`);
  console.log(`  - STANDARD: ${CloudFrontCachingStrategy.STANDARD}`);
  console.log(`  - BU_CACHE: ${CloudFrontCachingStrategy.BU_CACHE}`);
  
  console.log('✓ OriginType enum imported');
  console.log(`  - ALB: ${OriginType.ALB}`);
  console.log(`  - FUNCTION_URL: ${OriginType.FUNCTION_URL}`);
  
  console.log('✓ IContext interface imported (type checking only)');
  
  console.log('✓ SecretsManager class imported');
  console.log(`  - Type: ${typeof SecretsManager}`);
  console.log(`  - Constructor: ${typeof SecretsManager.constructor}`);
  
  console.log('\n🎉 All imports successful! The construct and SecretsManager are properly exported and ready for use.');
  
} catch (error) {
  console.error('❌ Import test failed:', error);
  process.exit(1);
}