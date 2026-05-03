use crate::model::{CardState, Rating, SrsState, StudyCard};
use chrono::{DateTime, Duration, Utc};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SchedulerSettings {
    pub initial_ease: f32,
    pub min_ease: f32,
    pub new_good_interval_days: u32,
    pub new_easy_interval_days: u32,
    pub again_minutes: i64,
    pub hard_multiplier: f32,
    pub hard_ease_penalty: f32,
    pub again_ease_penalty: f32,
    pub easy_ease_bonus: f32,
    pub max_interval_days: u32,
    pub fast_answer_ms: u32,
    pub slow_answer_ms: u32,
    pub fast_interval_bonus: f32,
    pub slow_interval_penalty: f32,
    pub fast_ease_bonus: f32,
    pub slow_ease_penalty: f32,
}

impl Default for SchedulerSettings {
    fn default() -> Self {
        Self {
            initial_ease: 2.5,
            min_ease: 1.3,
            new_good_interval_days: 1,
            new_easy_interval_days: 4,
            again_minutes: 10,
            hard_multiplier: 1.2,
            hard_ease_penalty: 0.15,
            again_ease_penalty: 0.20,
            easy_ease_bonus: 0.15,
            max_interval_days: 3650,
            fast_answer_ms: 5_000,
            slow_answer_ms: 20_000,
            fast_interval_bonus: 1.15,
            slow_interval_penalty: 0.80,
            fast_ease_bonus: 0.05,
            slow_ease_penalty: 0.10,
        }
    }
}

pub fn default_srs_state(now: DateTime<Utc>, settings: SchedulerSettings) -> SrsState {
    SrsState {
        state: CardState::New,
        due_at: None,
        interval_days: 0,
        ease: settings.initial_ease,
        reps: 0,
        lapses: 0,
        last_reviewed_at: None,
        last_rating: None,
        hard_count: 0,
        created_at: now,
    }
}

pub fn schedule_review(
    previous: &SrsState,
    rating: Rating,
    now: DateTime<Utc>,
    settings: SchedulerSettings,
) -> SrsState {
    schedule_review_with_response_time(previous, rating, None, now, settings)
}

pub fn schedule_review_with_response_time(
    previous: &SrsState,
    rating: Rating,
    response_time_ms: Option<u32>,
    now: DateTime<Utc>,
    settings: SchedulerSettings,
) -> SrsState {
    let was_new = is_new_state(previous);
    let mut next = previous.clone();
    next.reps += 1;
    next.last_reviewed_at = Some(now);
    next.last_rating = Some(rating);

    match rating {
        Rating::Again => {
            next.state = CardState::Learning;
            next.lapses += 1;
            next.ease = (next.ease - settings.again_ease_penalty).max(settings.min_ease);
            next.interval_days = 0;
            next.due_at = Some(now + Duration::minutes(settings.again_minutes));
        }
        Rating::Hard => {
            next.state = CardState::Review;
            next.hard_count += 1;
            next.ease = (next.ease - settings.hard_ease_penalty).max(settings.min_ease);
            next.interval_days = clamp_interval(
                ((previous.interval_days.max(1) as f32) * settings.hard_multiplier).round() as u32,
                settings,
            );
            next.due_at = Some(now + Duration::days(next.interval_days as i64));
        }
        Rating::Good => {
            next.state = CardState::Review;
            next.interval_days = if was_new || previous.interval_days == 0 {
                settings.new_good_interval_days
            } else {
                ((previous.interval_days as f32) * next.ease)
                    .round()
                    .max(1.0) as u32
            };
            next.interval_days = clamp_interval(next.interval_days, settings);
            next.due_at = Some(now + Duration::days(next.interval_days as i64));
        }
        Rating::Easy => {
            next.state = CardState::Review;
            next.ease += settings.easy_ease_bonus;
            next.interval_days = if was_new || previous.interval_days == 0 {
                settings.new_easy_interval_days
            } else {
                ((previous.interval_days as f32) * next.ease * 1.35)
                    .round()
                    .max(2.0) as u32
            };
            next.interval_days = clamp_interval(next.interval_days, settings);
            next.due_at = Some(now + Duration::days(next.interval_days as i64));
        }
    }

    apply_response_time_adjustment(&mut next, rating, response_time_ms, settings);

    next
}

pub fn is_due(card: &StudyCard, now: DateTime<Utc>) -> bool {
    card.srs.due_at.is_none_or(|due_at| due_at <= now)
}

pub fn is_new(card: &StudyCard) -> bool {
    is_new_state(&card.srs)
}

pub fn is_weak(card: &StudyCard) -> bool {
    card.srs.lapses >= 2
        || card.srs.ease <= 1.6
        || card.srs.last_rating == Some(Rating::Again)
        || card.srs.hard_count >= 2
}

fn is_new_state(state: &SrsState) -> bool {
    state.reps == 0 || state.due_at.is_none()
}

fn clamp_interval(interval_days: u32, settings: SchedulerSettings) -> u32 {
    interval_days.min(settings.max_interval_days)
}

fn apply_response_time_adjustment(
    next: &mut SrsState,
    rating: Rating,
    response_time_ms: Option<u32>,
    settings: SchedulerSettings,
) {
    let Some(response_time_ms) = response_time_ms else {
        return;
    };
    if rating == Rating::Again || next.interval_days == 0 {
        return;
    }

    if response_time_ms <= settings.fast_answer_ms && matches!(rating, Rating::Good | Rating::Easy) {
        next.ease += settings.fast_ease_bonus;
        next.interval_days = clamp_interval(
            ((next.interval_days as f32) * settings.fast_interval_bonus).round().max(1.0) as u32,
            settings,
        );
    } else if response_time_ms >= settings.slow_answer_ms && matches!(rating, Rating::Hard | Rating::Good) {
        next.ease = (next.ease - settings.slow_ease_penalty).max(settings.min_ease);
        next.interval_days = clamp_interval(
            ((next.interval_days as f32) * settings.slow_interval_penalty).round().max(1.0) as u32,
            settings,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn schedules_good_for_new_card() {
        let now = Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap();
        let settings = SchedulerSettings::default();
        let state = default_srs_state(now, settings);

        let next = schedule_review(&state, Rating::Good, now, settings);

        assert_eq!(next.state, CardState::Review);
        assert_eq!(next.interval_days, 1);
        assert_eq!(next.due_at.unwrap(), now + Duration::days(1));
    }

    #[test]
    fn schedules_again_for_learning() {
        let now = Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap();
        let settings = SchedulerSettings::default();
        let state = default_srs_state(now, settings);

        let next = schedule_review(&state, Rating::Again, now, settings);

        assert_eq!(next.state, CardState::Learning);
        assert_eq!(next.lapses, 1);
        assert_eq!(next.interval_days, 0);
        assert_eq!(next.due_at.unwrap(), now + Duration::minutes(10));
    }

    #[test]
    fn fast_good_answer_boosts_interval_and_ease() {
        let now = Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap();
        let settings = SchedulerSettings::default();
        let mut state = default_srs_state(now, settings);
        state.state = CardState::Review;
        state.due_at = Some(now);
        state.interval_days = 10;
        state.reps = 3;

        let next = schedule_review_with_response_time(&state, Rating::Good, Some(4_000), now, settings);

        assert!(next.interval_days > 25);
        assert!(next.ease > state.ease);
    }

    #[test]
    fn slow_good_answer_reduces_interval_and_ease() {
        let now = Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap();
        let settings = SchedulerSettings::default();
        let mut state = default_srs_state(now, settings);
        state.state = CardState::Review;
        state.due_at = Some(now);
        state.interval_days = 10;
        state.reps = 3;

        let next = schedule_review_with_response_time(&state, Rating::Good, Some(25_000), now, settings);

        assert!(next.interval_days < 25);
        assert!(next.ease < state.ease);
    }

    #[test]
    fn again_ignores_response_time() {
        let now = Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap();
        let settings = SchedulerSettings::default();
        let state = default_srs_state(now, settings);

        let without_time = schedule_review_with_response_time(&state, Rating::Again, None, now, settings);
        let with_time = schedule_review_with_response_time(&state, Rating::Again, Some(1_000), now, settings);

        assert_eq!(with_time.interval_days, without_time.interval_days);
        assert_eq!(with_time.due_at, without_time.due_at);
        assert_eq!(with_time.ease, without_time.ease);
    }
}
