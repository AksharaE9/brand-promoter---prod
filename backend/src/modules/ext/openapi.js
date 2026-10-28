'use strict';

/**
 * backend/src/modules/ext/openapi.js
 *
 * OpenAPI 3.1 Specification for TalentOS External API (v1).
 */

function getOpenApiSpec(baseUrl = 'https://brandpromoter-backend.onrender.com') {
  return {
    openapi: '3.1.0',
    info: {
      title: 'TalentOS ATS External API',
      version: '1.0.0',
      description: 'Secure, read-only external REST API for pulling candidates, evaluation rounds, campus hiring drives, jobs, and team members from TalentOS ATS.',
      contact: {
        name: 'TalentOS Engineering Support',
        email: 'support@aksharaenterprises.info',
      },
    },
    servers: [
      {
        url: baseUrl,
        description: 'Current Environment Server',
      },
    ],
    security: [
      { bearerAuth: [] },
      { apiKeyAuth: [] },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Provide your API key as a Bearer token: `Authorization: Bearer tos_live_...`',
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'Provide your API key in the `X-API-Key` header.',
        },
      },
      schemas: {
        ApiErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            code: { type: 'string', example: 'API_KEY_INSUFFICIENT_SCOPE' },
            message: { type: 'string', example: "This endpoint requires the 'candidates:read' scope." },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'API_KEY_INSUFFICIENT_SCOPE' },
                message: { type: 'string' },
                requestId: { type: 'string', example: 'req_be_7f9c2d1a3e8b4560' },
                details: { type: 'object' },
              },
            },
          },
        },
        PaginationMeta: {
          type: 'object',
          properties: {
            nextCursor: { type: 'string', nullable: true, example: 'MjAyNi0xMC0yN1QxMDowMDowMC4wMDBafGNtdnJvbXdpbzAwNDV0YjA4amRqY3F0MTE' },
            limit: { type: 'integer', example: 50 },
            hasMore: { type: 'boolean', example: true },
          },
        },
        Candidate: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'cmvqbje7d005rtbqoy2wvmg7c' },
            fullName: { type: 'string', example: 'Prajval Raj K' },
            status: { type: 'string', example: 'INTERVIEWING' },
            currentStage: { type: 'string', nullable: true, example: 'Round 1' },
            preferredRole: { type: 'string', nullable: true, example: 'Data Analyst Intern' },
            course: { type: 'string', nullable: true, example: 'B.E. (Computer Science & Engineering)' },
            college: { type: 'string', nullable: true, example: 'Rajarajeshwari College of Engineering (RRCE)' },
            graduationYear: { type: 'string', nullable: true, example: '2027' },
            location: { type: 'string', nullable: true, example: 'Bengaluru' },
            area: { type: 'string', nullable: true, example: 'Kengeri' },
            totalExperienceYears: { type: 'number', nullable: true, example: 0 },
            currentCompany: { type: 'string', nullable: true },
            company: { type: 'string', nullable: true, example: 'Akshara Enterprises' },
            source: { type: 'string', nullable: true, example: 'Campus Drive - RRCE' },
            phone: { type: 'string', nullable: true, description: 'Only included if candidates:read:pii scope is granted', example: '+91 98445 47162' },
            email: { type: 'string', nullable: true, description: 'Only included if candidates:read:pii scope is granted', example: 'prajval@example.com' },
            resumeDownloadUrl: { type: 'string', nullable: true, description: '15-minute signed download URL (requires candidates:read:pii)' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Interview: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'cmvroi7hn0001tbj4vb66z7ql' },
            candidateId: { type: 'string', example: 'cmvqbje7d005rtbqoy2wvmg7c' },
            candidateName: { type: 'string', example: 'Prajval Raj K' },
            jobId: { type: 'string', example: 'cmrnjjhvp0092lg2ry71l2zkt' },
            jobTitle: { type: 'string', example: 'Data Analyst Intern' },
            roundNo: { type: 'integer', example: 1 },
            roundTitle: { type: 'string', example: 'Round 1' },
            scheduledStart: { type: 'string', format: 'date-time', example: '2026-10-27T04:30:00.000Z' },
            durationMinutes: { type: 'integer', example: 45 },
            mode: { type: 'string', example: 'DRIVE' },
            status: { type: 'string', example: 'COMPLETED' },
            outcome: { type: 'string', enum: ['SELECTED', 'REJECTED', 'ON_HOLD', 'NO_SHOW'], example: 'SELECTED' },
            outcomeSetAt: { type: 'string', format: 'date-time' },
            panelist: { type: 'string', example: 'Vinay Shetty' },
            notes: { type: 'string', nullable: true },
            feedback: {
              type: 'object',
              nullable: true,
              properties: {
                overallRating: { type: 'number', example: 7 },
                selectionStatus: { type: 'string', example: 'SELECTED' },
                panelist: { type: 'string', example: 'Vinay Shetty' },
                comments: { type: 'string', example: 'Good analytical skills and clear SQL fundamentals.' },
                submittedAt: { type: 'string', format: 'date-time' },
              },
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        CollegeDrive: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string', example: 'Rajarajeshwari College of Engineering (RRCE) - Campus Drive' },
            collegeId: { type: 'string' },
            collegeName: { type: 'string', example: 'Rajarajeshwari College of Engineering (RRCE)' },
            location: { type: 'string', example: 'Bengaluru' },
            area: { type: 'string', example: 'Mysore Road' },
            dateFrom: { type: 'string', example: '2026-10-27' },
            dateTo: { type: 'string', nullable: true, example: '2026-10-27' },
            status: { type: 'string', example: 'COMPLETED' },
            description: { type: 'string', nullable: true },
            counts: {
              type: 'object',
              properties: {
                totalEnrolled: { type: 'integer', example: 25 },
                selected: { type: 'integer', example: 8 },
                rejected: { type: 'integer', example: 17 },
                onHold: { type: 'integer', example: 0 },
              },
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Job: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string', example: 'Data Analyst Intern' },
            department: { type: 'string', nullable: true, example: 'Analytics' },
            location: { type: 'string', nullable: true, example: 'Bengaluru' },
            employmentType: { type: 'string', nullable: true, example: 'Internship' },
            experienceMin: { type: 'number', nullable: true, example: 0 },
            experienceMax: { type: 'number', nullable: true, example: 1 },
            openingsCount: { type: 'integer', example: 10 },
            description: { type: 'string', nullable: true },
            isActive: { type: 'boolean', example: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        TeamMember: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string', example: 'Shreesha' },
            active: { type: 'boolean', example: true },
            createdAt: { type: 'string', format: 'date-time' },
            deactivatedAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },
      },
    },
    paths: {
      '/api/v1/ext/health': {
        get: {
          summary: 'Liveness & Service Health',
          description: 'Checks external API health. Does not require authentication.',
          security: [],
          responses: {
            200: {
              description: 'Service operational',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      version: { type: 'string', example: '1.0.0' },
                      timestamp: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/v1/ext/me': {
        get: {
          summary: 'API Key Introspection',
          description: 'Returns metadata, scopes, environment, and rate limit for the authenticating API key.',
          responses: {
            200: {
              description: 'Key introspection details',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          keyId: { type: 'string' },
                          name: { type: 'string', example: 'Akshara ERP Production' },
                          prefix: { type: 'string', example: 'tos_live_7Kq2Hx9a' },
                          scopes: { type: 'array', items: { type: 'string' }, example: ['candidates:read', 'interviews:read'] },
                          environment: { type: 'string', example: 'live' },
                          rateLimitPerMinute: { type: 'integer', example: 60 },
                        },
                      },
                      meta: { type: 'object', properties: { requestId: { type: 'string' } } },
                    },
                  },
                },
              },
            },
            401: { description: 'Missing, revoked, or expired API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiErrorResponse' } } } },
          },
        },
      },
      '/api/v1/ext/candidates': {
        get: {
          summary: 'List Candidates',
          description: 'Returns keyset-paginated candidates. Requires `candidates:read`. Pass `candidates:read:pii` to receive phone and email.',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'driveId', in: 'query', schema: { type: 'string' } },
            { name: 'jobId', in: 'query', schema: { type: 'string' } },
            { name: 'updatedSince', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: {
            200: {
              description: 'List of candidates',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Candidate' } },
                      page: { $ref: '#/components/schemas/PaginationMeta' },
                      meta: { type: 'object', properties: { requestId: { type: 'string' } } },
                    },
                  },
                },
              },
            },
            403: { description: 'Missing candidates:read scope' },
          },
        },
      },
      '/api/v1/ext/candidates/{id}': {
        get: {
          summary: 'Get Candidate Profile',
          description: 'Returns candidate profile and summary of rounds. Requires `candidates:read`.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { $ref: '#/components/schemas/Candidate' },
                      meta: { type: 'object', properties: { requestId: { type: 'string' } } },
                    },
                  },
                },
              },
            },
            404: { description: 'Candidate not found' },
          },
        },
      },
      '/api/v1/ext/candidates/{id}/interviews': {
        get: {
          summary: 'Get Candidate Interviews & Feedback',
          description: 'Returns evaluation rounds, ratings, panelist names, and feedback comments. Requires `interviews:read`.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Interview' } },
                      meta: { type: 'object', properties: { requestId: { type: 'string' } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/v1/ext/interviews': {
        get: {
          summary: 'List Interviews',
          description: 'Returns keyset-paginated interviews with evaluation results. Requires `interviews:read`.',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'outcome', in: 'query', schema: { type: 'string', enum: ['SELECTED', 'REJECTED', 'ON_HOLD', 'NO_SHOW'] } },
            { name: 'round', in: 'query', schema: { type: 'integer' } },
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Scheduled date from (YYYY-MM-DD in IST)' },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Scheduled date to (YYYY-MM-DD in IST)' },
            { name: 'updatedSince', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: {
            200: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Interview' } },
                      page: { $ref: '#/components/schemas/PaginationMeta' },
                      meta: { type: 'object', properties: { requestId: { type: 'string' } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/v1/ext/drives': {
        get: {
          summary: 'List Campus Hiring Drives',
          description: 'Returns drives with aggregate enrollment and outcome counts. Requires `drives:read`.',
          responses: {
            200: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/CollegeDrive' } },
                      meta: { type: 'object', properties: { requestId: { type: 'string' } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/v1/ext/jobs': {
        get: {
          summary: 'List Jobs / Roles',
          description: 'Returns active job openings. Requires `jobs:read`.',
          responses: {
            200: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/Job' } },
                      meta: { type: 'object', properties: { requestId: { type: 'string' } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/v1/ext/team-members': {
        get: {
          summary: 'List Telecalling & Scheduling Team',
          description: 'Returns active telecalling members. Requires `team:read`.',
          responses: {
            200: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'array', items: { $ref: '#/components/schemas/TeamMember' } },
                      meta: { type: 'object', properties: { requestId: { type: 'string' } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/v1/ext/stats/summary': {
        get: {
          summary: 'Aggregate ATS Statistics',
          description: 'Returns totals by status, outcome, drive, and month. Requires `stats:read`.',
          responses: {
            200: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { type: 'object' },
                      meta: { type: 'object', properties: { requestId: { type: 'string' } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/v1/ext/changes': {
        get: {
          summary: 'Incremental Sync Feed',
          description: 'Returns IDs and change types (CREATED, UPDATED, DELETED) of records modified since timestamp.',
          parameters: [
            { name: 'since', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
            { name: 'resource', in: 'query', schema: { type: 'string', enum: ['candidates', 'interviews', 'drives', 'jobs'] } },
          ],
          responses: {
            200: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          since: { type: 'string', format: 'date-time' },
                          until: { type: 'string', format: 'date-time' },
                          changes: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                resource: { type: 'string' },
                                id: { type: 'string' },
                                action: { type: 'string', enum: ['CREATED', 'UPDATED', 'DELETED'] },
                                updatedAt: { type: 'string', format: 'date-time' },
                              },
                            },
                          },
                        },
                      },
                      meta: { type: 'object', properties: { requestId: { type: 'string' } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/api/v1/ext/resumes/{token}': {
        get: {
          summary: 'Download Candidate Resume',
          description: 'Streams resume file using short-lived signed token (valid for 15 minutes). Requires `candidates:read:pii`.',
          parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: { description: 'Resume file binary (JPEG or PDF)' },
            401: { description: 'Expired or invalid signed token' },
          },
        },
      },
    },
  };
}

module.exports = { getOpenApiSpec };
