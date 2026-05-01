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

    next
}

pub fn is_due(card: &StudyCard, now: DateTime<Utc>) -> bool {
    card.srs.due_at.map_or(true, |due_at| due_at <= now)
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
}
