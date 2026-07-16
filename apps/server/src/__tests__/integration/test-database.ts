// 통합테스트 전용 DB URL — dev(wchat_dev)를 절대 건드리지 않도록 별도 *_test DB 를 쓴다.
//   기본값 = 로컬 setup(wchat/localdev@localhost:5432/wchat_test). CI/다른 환경은 TEST_DATABASE_URL 로 override.
//   db-reset 가드가 DB 이름 *_test 를 요구하므로 반드시 _test 로 끝나야 한다.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://wchat:localdev@localhost:5432/wchat_test";
