'use strict';

const { streamUrlWithRedirects } = require('../../src/utils/downloadStream');
const https = require('https');
const http = require('http');
const { EventEmitter } = require('events');

jest.mock('https');
jest.mock('http');

describe('streamUrlWithRedirects Unit Tests', () => {
  let mockRes;

  beforeEach(() => {
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      headersSent: false,
    };
    jest.clearAllMocks();
  });

  test('Streams content directly on 200 OK', (done) => {
    const mockStreamRes = new EventEmitter();
    mockStreamRes.statusCode = 200;
    mockStreamRes.pipe = jest.fn();

    https.get.mockImplementation((url, cb) => {
      cb(mockStreamRes);
      return new EventEmitter();
    });

    streamUrlWithRedirects('https://example.com/file.txt', mockRes);

    setTimeout(() => {
      expect(https.get).toHaveBeenCalledWith('https://example.com/file.txt', expect.any(Function));
      expect(mockStreamRes.pipe).toHaveBeenCalledWith(mockRes);
      expect(mockRes.status).not.toHaveBeenCalled();
      done();
    }, 50);
  });

  test('Follows redirect (302 Found) to new location', (done) => {
    const redirectRes = new EventEmitter();
    redirectRes.statusCode = 302;
    redirectRes.headers = { location: 'https://newplace.com/file.txt' };

    const finalRes = new EventEmitter();
    finalRes.statusCode = 200;
    finalRes.pipe = jest.fn();

    https.get.mockImplementation((url, cb) => {
      if (url === 'https://example.com/file.txt') {
        cb(redirectRes);
      } else if (url === 'https://newplace.com/file.txt') {
        cb(finalRes);
      }
      return new EventEmitter();
    });

    streamUrlWithRedirects('https://example.com/file.txt', mockRes);

    setTimeout(() => {
      expect(https.get).toHaveBeenCalledWith('https://example.com/file.txt', expect.any(Function));
      expect(https.get).toHaveBeenCalledWith('https://newplace.com/file.txt', expect.any(Function));
      expect(finalRes.pipe).toHaveBeenCalledWith(mockRes);
      done();
    }, 50);
  });

  test('Aborts after 5 redirects to prevent loops', (done) => {
    const redirectRes = new EventEmitter();
    redirectRes.statusCode = 302;
    redirectRes.headers = { location: 'https://example.com/file.txt' };

    https.get.mockImplementation((url, cb) => {
      cb(redirectRes);
      return new EventEmitter();
    });

    streamUrlWithRedirects('https://example.com/file.txt', mockRes);

    setTimeout(() => {
      expect(mockRes.status).toHaveBeenCalledWith(502);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Too many redirects trying to download file',
      });
      done();
    }, 50);
  });

  test('Handles >=400 status codes by returning error JSON', (done) => {
    const errorRes = new EventEmitter();
    errorRes.statusCode = 404;

    https.get.mockImplementation((url, cb) => {
      cb(errorRes);
      return new EventEmitter();
    });

    streamUrlWithRedirects('https://example.com/file.txt', mockRes);

    setTimeout(() => {
      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to download from storage: HTTP 404',
      });
      done();
    }, 50);
  });
});
